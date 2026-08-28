import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
} from "pixi.js";
import { sound, type IMediaInstance } from "@pixi/sound";

// The Unity scene is a 16:9 orthographic composition: a white field, one
// 13.6-degree plane, a fixed player, and obstacles that drift up the plane.
const GAME_WIDTH = 1_920;
const GAME_HEIGHT = 1_080;
const MAX_DELTA_SECONDS = 0.035;
const SLOPE_RISE = Math.tan((13.6 * Math.PI) / 180);
const RAMP_TOP_Y = 585;
const RAMP_BOTTOM_Y = GAME_HEIGHT + 256;
const PLAYER_X = GAME_WIDTH / 2;
const PLAYER_SIZE = 192;
const PLAYER_RADIUS = PLAYER_SIZE / 2;
const PLAYER_SCREEN_Y = GAME_HEIGHT / 2 + 48;
const SCORE_SCREEN_Y = PLAYER_SCREEN_Y - 170;
const ICECREAM_WIDTH = 133;
const ICECREAM_HEIGHT = 500;
const ICECREAM_VERTICAL_OFFSET = 18;
// The Unity spawner creates ice cream beyond the camera's right edge. It then
// crosses the screen on the same 13.6-degree diagonal as the ramp.
const ICECREAM_SPAWN_X = 2_550;
const FIRST_ICECREAM_DELAY = 5;
const ICECREAM_SPAWN_INTERVAL = 5;
const MIN_ICECREAM_SPAWN_INTERVAL = 2.5;
// The original starts calm. Keep the shared 1× → 2× curve slow enough that
// the opening remains readable: 1.19× at 30s, 1.41× at 60s, 2× at 120s.
const SPEED_DOUBLING_SECONDS = 120;
const MAX_SPEED_MULTIPLIER = 2;
const PLAYER_ROLL_RADIANS_PER_SECOND = Math.PI * 3;
// IcecreamMove.cs starts at 9 world units/second. In this 1920px scene that
// is roughly 1,500px/s before the shared difficulty multiplier applies.
const ICECREAM_SPEED = 1_500;
// Unity uses Physics2D gravity × 4 and one AddForce(1000) impulse. These
// 1920px-equivalent values keep the rise quick and the landing decisive.
const GRAVITY = 6_540;
const JUMP_VELOCITY = -3_330;
// Makebic.cs starts testing at 20 seconds. The first bicycle is guaranteed at
// that point so its original 5% random cadence cannot make the feature vanish
// during a short round; later checks preserve the source's occasional feel.
const BICYCLE_FIRST_DELAY = 20;
const BICYCLE_SPAWN_CHECK_INTERVAL = 1;
const BICYCLE_SPAWN_CHANCE = 0.05;
const BICYCLE_SPAWN_X = -1_950;
const BICYCLE_WIDTH = 385;
const BICYCLE_HEIGHT = 243;
const BICYCLE_SPEED = 1_420;
const BICYCLE_ROTATION = (13.6 * Math.PI) / 180;
const GAME_OVER_FACE_SWAY_RADIANS = (7 * Math.PI) / 180;
const GAME_OVER_FACE_SWAY_SPEED = 84;
const PLAYER_COLLISION_RADIUS = PLAYER_RADIUS * 0.78;
const ICECREAM_CREAM_COLLIDERS = [
  { x: 0, y: -470, radius: 17 },
  { x: 0, y: -423, radius: 39 },
  { x: 0, y: -360, radius: 51 },
  { x: 0, y: -292, radius: 61 },
  { x: 0, y: -230, radius: 65 },
] as const;
const ICECREAM_CONE = [
  { x: -56, y: -205 },
  { x: 56, y: -205 },
  { x: 0, y: 0 },
] as const;
const BICYCLE_WHEEL_COLLIDERS = [
  { x: -117, y: 46, radius: 68 },
  { x: 112, y: 46, radius: 68 },
] as const;
const BICYCLE_FRAME_COLLIDER_RADIUS = 11;
const BICYCLE_FRAME_SEGMENTS = [
  [{ x: -117, y: 46 }, { x: 38, y: 46 }],
  [{ x: 38, y: 46 }, { x: 112, y: 46 }],
  [{ x: -117, y: 46 }, { x: -38, y: -31 }],
  [{ x: -38, y: -31 }, { x: 38, y: 46 }],
  [{ x: -38, y: -31 }, { x: 72, y: -45 }],
  [{ x: 72, y: -45 }, { x: 38, y: 46 }],
  [{ x: 72, y: -45 }, { x: 112, y: 46 }],
  [{ x: -38, y: -31 }, { x: -48, y: -72 }],
  [{ x: 72, y: -45 }, { x: 88, y: -88 }],
] as const;
const browserWindow = globalThis.window;

const COLORS = {
  canvas: 0xffffff,
  score: 0x4d4d4d,
  ramp: 0x4b4b4b,
  letterbox: 0x111111,
  overlay: 0x171313,
  cream: 0xffffff,
};

type GameState = "play" | "paused" | "game-over";
type ImageAsset = "root" | "sad" | "icecream" | "bicycle";
type GameTextures = Record<ImageAsset, Texture>;

const SOUND_SOURCES = {
  bgm: {
    url: "/audio/bgm.mp3",
    volume: 0.28,
    loop: true,
    singleInstance: true,
  },
  start: {
    url: "/audio/game_start.mp3",
    volume: 0.42,
    singleInstance: true,
  },
  jump: {
    url: "/audio/jump.mp3",
    volume: 0.36,
    singleInstance: true,
  },
  die: {
    url: "/audio/die.mp3",
    volume: 0.42,
    singleInstance: true,
  },
  bicycle: {
    url: "/audio/bicycle.mp3",
    volume: 0.34,
    singleInstance: true,
  },
} as const;

type SoundName = keyof typeof SOUND_SOURCES;
type EffectSoundName = Exclude<SoundName, "bgm">;

interface Obstacle {
  kind: "icecream" | "bicycle";
  sprite: Sprite;
  scored: boolean;
}

interface Point {
  x: number;
  y: number;
}

const ASSET_MANIFEST = {
  bundles: [
    {
      name: "rolling-root",
      assets: [
        { alias: "root", src: "/images/root.png" },
        { alias: "sad", src: "/images/sad.png" },
        { alias: "icecream", src: "/images/icecream.png" },
        { alias: "bicycle", src: "/images/bicycle.png" },
      ],
    },
  ],
};

const textStyle = (
  fontSize: number,
  fill: number = COLORS.cream,
  fontWeight: "400" | "700" = "400",
) => ({
  fill,
  fontFamily: '"One Mobile POP", sans-serif',
  fontSize,
  fontWeight,
  lineHeight: Math.ceil(fontSize * 1.14),
});

const slopeY = (x: number): number => RAMP_TOP_Y + x * SLOPE_RISE;
const playerGroundY = (): number => slopeY(PLAYER_X) - PLAYER_RADIUS;

class RollingRootGame {
  private readonly app = new Application();
  private readonly world = new Container({ label: "game-world" });
  private readonly backdrop = new Graphics();
  private readonly sceneMask = new Graphics();
  private readonly ramp = new Graphics();
  private readonly gameLayer = new Container({ label: "play" });
  private readonly hudLayer = new Container({ label: "hud" });
  private readonly obstacleLayer = new Container({ label: "obstacles" });
  private readonly pauseLayer = new Container({ label: "paused" });
  private readonly gameOverLayer = new Container({ label: "game-over" });

  private textures!: GameTextures;
  private player!: Sprite;
  private gameOverFace!: Sprite;
  private pauseDimmer!: Graphics;
  private gameOverDimmer!: Graphics;
  private scoreText!: Text;
  private gameOverScoreText!: Text;
  private gameOverBestText!: Text;

  private state: GameState = "game-over";
  private obstacles: Obstacle[] = [];
  private elapsed = 0;
  private spawnElapsed = 0;
  private hasSpawnedFirstIcecream = false;
  private bicycleCheckElapsed = 0;
  private hasSpawnedFirstBicycle = false;
  private score = 0;
  private bestScore = 0;
  private playerVelocityY = 0;
  private playerRollAngle = 0.34;
  private gameOverFaceElapsed = 0;
  private isJumping = false;
  private audioUnlocked = false;
  private audioResumePromise: Promise<boolean> | null = null;
  private startCuePending = false;
  private bgmInstance: IMediaInstance | null = null;
  private bgmStarting = false;
  private bgmRequestId = 0;
  private bootDismissed = false;
  private lastScreenWidth = 0;
  private lastScreenHeight = 0;
  private viewportTop = 0;
  private viewportHeight = GAME_HEIGHT;

  public constructor(
    private readonly mount: HTMLElement,
    private readonly bootSplash: HTMLElement,
    private readonly status: HTMLElement,
  ) {}

  public async init(): Promise<void> {
    await document.fonts?.load('16px "One Mobile POP"');
    await Assets.init({ manifest: ASSET_MANIFEST });
    // Pixi Sound uses Web Audio when available. Preload and decode every clip
    // before the game starts so a jump only creates a ready-to-play instance.
    if (sound.supported) {
      sound.disableAutoPause = true;
    }
    const [textures] = await Promise.all([
      Assets.loadBundle("rolling-root"),
      this.loadSounds(),
    ]);
    this.textures = textures as GameTextures;

    await this.app.init({
      antialias: true,
      autoDensity: true,
      background: COLORS.letterbox,
      resizeTo: this.mount,
      resolution: Math.min(browserWindow.devicePixelRatio || 1, 2),
    });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.setAttribute(
      "aria-label",
      "Rolling Root. 얼굴은 경사로 위에서 회전하고, 탭 또는 키 입력으로 점프합니다.",
    );
    canvas.setAttribute("role", "application");
    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", this.onCanvasPointerDown, {
      passive: false,
    });
    browserWindow.addEventListener("keydown", this.onKeyDown);
    browserWindow.addEventListener("blur", this.onWindowBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.mount.appendChild(canvas);
    this.world.addChild(
      this.backdrop,
      this.gameLayer,
      this.hudLayer,
      this.sceneMask,
    );
    this.app.stage.addChild(this.world);

    this.buildPlayScene();
    this.layoutWorld();
    this.app.ticker.add(() => this.update(this.app.ticker.deltaMS / 1_000));
    this.startGame(false);

    browserWindow.requestAnimationFrame(() => {
      this.dismissBootSplash();
      this.mount.setAttribute("aria-busy", "false");
    });
  }

  private readonly onCanvasPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    (this.app.canvas as HTMLCanvasElement).focus({ preventScroll: true });
    this.handlePrimaryAction();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof Element &&
      event.target.closest(
        "button, input, select, textarea, [contenteditable='true']",
      )
    ) {
      return;
    }

    if (
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.key === "Tab"
    ) {
      return;
    }

    // Unity's circlejump.cs used Input.anyKeyDown, so both restart and jump
    // deliberately accept every ordinary key instead of only a mobile gesture.
    event.preventDefault();
    this.handlePrimaryAction();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.pauseGame();
    }
  };

  private readonly onWindowBlur = (): void => {
    this.pauseGame();
  };

  private async loadSounds(): Promise<void> {
    await Promise.all(
      Object.entries(SOUND_SOURCES).map(
        ([alias, source]) =>
          new Promise<void>((resolve, reject) => {
            sound.add(alias, {
              ...source,
              preload: true,
              loaded: (error) => {
                if (error) {
                  reject(error);
                  return;
                }

                resolve();
              },
            });
          }),
      ),
    );
  }

  private buildPlayScene(): void {
    this.gameLayer.mask = this.sceneMask;

    this.player = new Sprite(this.textures.root);
    this.player.anchor.set(0.5);
    this.player.setSize(PLAYER_SIZE, PLAYER_SIZE);
    this.player.position.set(PLAYER_X, playerGroundY());

    this.scoreText = new Text({
      text: "0",
      style: textStyle(88, COLORS.score, "700"),
    });
    this.scoreText.anchor.set(0.5);
    this.scoreText.position.set(PLAYER_X, SCORE_SCREEN_Y);

    this.buildGameOverScene();
    this.buildPauseScene();
    this.gameLayer.addChild(this.ramp, this.obstacleLayer, this.player);
    this.hudLayer.addChild(this.scoreText, this.pauseLayer, this.gameOverLayer);
  }

  private buildPauseScene(): void {
    this.pauseLayer.visible = false;

    this.pauseDimmer = new Graphics();

    const title = new Text({
      text: "일시정지",
      style: textStyle(74),
    });
    title.anchor.set(0.5);
    title.position.set(GAME_WIDTH / 2, 510);

    const instruction = new Text({
      text: "탭 또는 아무 키로 계속",
      style: textStyle(31),
    });
    instruction.anchor.set(0.5);
    instruction.position.set(GAME_WIDTH / 2, 614);

    this.pauseLayer.addChild(this.pauseDimmer, title, instruction);
  }

  private buildGameOverScene(): void {
    this.gameOverLayer.visible = false;

    this.gameOverDimmer = new Graphics();

    const sad = new Sprite(this.textures.sad);
    sad.anchor.set(0.5);
    sad.setSize(230, 230);
    sad.position.set(GAME_WIDTH / 2, 334);
    this.gameOverFace = sad;

    const title = new Text({
      text: "GAME OVER",
      style: textStyle(74),
    });
    title.anchor.set(0.5);
    title.position.set(GAME_WIDTH / 2, 547);

    this.gameOverScoreText = new Text({
      text: "점수 0",
      style: textStyle(42),
    });
    this.gameOverScoreText.anchor.set(0.5);
    this.gameOverScoreText.position.set(GAME_WIDTH / 2, 635);

    this.gameOverBestText = new Text({
      text: "최고 0",
      style: textStyle(34),
    });
    this.gameOverBestText.anchor.set(0.5);
    this.gameOverBestText.position.set(GAME_WIDTH / 2, 698);

    const retry = new Text({
      text: "탭 또는 아무 키로 다시 시작",
      style: textStyle(29),
    });
    retry.anchor.set(0.5);
    retry.position.set(GAME_WIDTH / 2, 828);

    this.gameOverLayer.addChild(
      this.gameOverDimmer,
      sad,
      title,
      this.gameOverScoreText,
      this.gameOverBestText,
      retry,
    );
  }

  private update(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, MAX_DELTA_SECONDS);
    this.layoutWorld();

    if (this.state === "play") {
      this.updatePlay(delta);
    } else if (this.state === "game-over") {
      this.updateGameOverFace(delta);
    }
  }

  private updateGameOverFace(delta: number): void {
    this.gameOverFaceElapsed += delta;
    this.gameOverFace.rotation =
      Math.sin(this.gameOverFaceElapsed * GAME_OVER_FACE_SWAY_SPEED) *
      GAME_OVER_FACE_SWAY_RADIANS;
  }

  private updatePlay(delta: number): void {
    this.elapsed += delta;
    const speedMultiplier = this.getSpeedMultiplier();
    this.playerRollAngle =
      (this.playerRollAngle +
        PLAYER_ROLL_RADIANS_PER_SECOND * speedMultiplier * delta) %
      (Math.PI * 2);
    this.player.rotation = this.playerRollAngle;
    if (this.bgmInstance) {
      sound.speed("bgm", speedMultiplier);
    }
    this.updatePlayerPhysics(delta);
    this.updateObstacles(delta, speedMultiplier);
    this.updateBicycleSpawner(delta);

    this.spawnElapsed += delta;
    const interval = this.hasSpawnedFirstIcecream
      ? Math.max(
          MIN_ICECREAM_SPAWN_INTERVAL,
          ICECREAM_SPAWN_INTERVAL / speedMultiplier,
        )
      : FIRST_ICECREAM_DELAY;
    if (this.spawnElapsed >= interval) {
      this.spawnElapsed = 0;
      this.spawnIcecream();
      this.hasSpawnedFirstIcecream = true;
    }
  }

  private getSpeedMultiplier(): number {
    return Math.min(
      MAX_SPEED_MULTIPLIER,
      2 ** (this.elapsed / SPEED_DOUBLING_SECONDS),
    );
  }

  private updatePlayerPhysics(delta: number): void {
    if (!this.isJumping) {
      this.updateCamera();
      return;
    }

    this.playerVelocityY += GRAVITY * delta;
    this.player.y += this.playerVelocityY * delta;

    if (this.player.y >= playerGroundY()) {
      this.player.y = playerGroundY();
      this.playerVelocityY = 0;
      this.isJumping = false;
      this.setStatus("착지했습니다. 다음 아이스크림을 넘으세요.");
    }

    this.updateCamera();
  }

  private updateCamera(): void {
    // camera_move.cs keeps the player at the same viewport position while its
    // Y coordinate changes, so the ramp and ice cream move down during a jump.
    this.gameLayer.y = PLAYER_SCREEN_Y - this.player.y;
  }

  private spawnIcecream(spawnX = ICECREAM_SPAWN_X): void {
    const sprite = new Sprite(this.textures.icecream);
    sprite.anchor.set(0.5, 1);
    sprite.setSize(ICECREAM_WIDTH, ICECREAM_HEIGHT);
    sprite.position.set(spawnX, slopeY(spawnX) + ICECREAM_VERTICAL_OFFSET);
    this.obstacleLayer.addChild(sprite);
    this.obstacles.push({ kind: "icecream", sprite, scored: false });
  }

  private updateBicycleSpawner(delta: number): void {
    if (!this.hasSpawnedFirstBicycle) {
      if (this.elapsed >= BICYCLE_FIRST_DELAY) {
        this.spawnBicycle();
        this.hasSpawnedFirstBicycle = true;
      }
      return;
    }

    this.bicycleCheckElapsed += delta;
    while (this.bicycleCheckElapsed >= BICYCLE_SPAWN_CHECK_INTERVAL) {
      this.bicycleCheckElapsed -= BICYCLE_SPAWN_CHECK_INTERVAL;
      if (Math.random() < BICYCLE_SPAWN_CHANCE) {
        this.spawnBicycle();
      }
    }
  }

  private spawnBicycle(): void {
    const sprite = new Sprite(this.textures.bicycle);
    sprite.anchor.set(0.5);
    sprite.setSize(BICYCLE_WIDTH, BICYCLE_HEIGHT);
    sprite.rotation = BICYCLE_ROTATION;
    sprite.position.set(BICYCLE_SPAWN_X, this.bicycleY(BICYCLE_SPAWN_X));
    this.obstacleLayer.addChild(sprite);
    this.obstacles.push({ kind: "bicycle", sprite, scored: false });
    this.playEffect("bicycle");
  }

  private bicycleY(x: number): number {
    // The sprite rotates with the 13.6° ramp. Its tire contact point moves
    // horizontally during that rotation, so include both the cosine and slope
    // terms rather than adding a fixed vertical clearance.
    const tireContactOffset =
      (BICYCLE_HEIGHT / 2) *
      (Math.cos(BICYCLE_ROTATION) + SLOPE_RISE * Math.sin(BICYCLE_ROTATION));
    return slopeY(x) - tireContactOffset;
  }

  private updateObstacles(delta: number, speedMultiplier: number): void {
    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = this.obstacles[index];
      if (obstacle.kind === "icecream") {
        obstacle.sprite.x -= ICECREAM_SPEED * speedMultiplier * delta;
        obstacle.sprite.y =
          slopeY(obstacle.sprite.x) + ICECREAM_VERTICAL_OFFSET;
      } else {
        obstacle.sprite.x += BICYCLE_SPEED * speedMultiplier * delta;
        obstacle.sprite.y = this.bicycleY(obstacle.sprite.x);
      }

      if (this.collidesWithPlayer(obstacle)) {
        this.endGame();
        return;
      }

      if (
        obstacle.kind === "icecream" &&
        !obstacle.scored &&
        obstacle.sprite.x < PLAYER_X - PLAYER_RADIUS
      ) {
        obstacle.scored = true;
        this.score += 1;
        this.scoreText.text = String(this.score);
        this.setStatus(`점수 ${this.score}.`);
      }

      if (
        (obstacle.kind === "icecream" &&
          obstacle.sprite.x < -obstacle.sprite.width) ||
        (obstacle.kind === "bicycle" &&
          obstacle.sprite.x > GAME_WIDTH + obstacle.sprite.width)
      ) {
        obstacle.sprite.destroy();
        this.obstacles.splice(index, 1);
      }
    }
  }

  private collidesWithPlayer(obstacle: Obstacle): boolean {
    if (obstacle.kind === "icecream") {
      return this.collidesWithIcecream(obstacle.sprite);
    }

    return this.collidesWithBicycle(obstacle.sprite);
  }

  private collidesWithIcecream(icecream: Sprite): boolean {
    for (const circle of ICECREAM_CREAM_COLLIDERS) {
      const dx = this.player.x - (icecream.x + circle.x);
      const dy = this.player.y - (icecream.y + circle.y);
      const collisionRadius = PLAYER_COLLISION_RADIUS + circle.radius;
      if (dx * dx + dy * dy <= collisionRadius * collisionRadius) {
        return true;
      }
    }

    const cone = ICECREAM_CONE.map(({ x, y }) => ({
      x: icecream.x + x,
      y: icecream.y + y,
    }));
    return this.circleIntersectsTriangle(
      this.player.x,
      this.player.y,
      PLAYER_COLLISION_RADIUS,
      cone[0],
      cone[1],
      cone[2],
    );
  }

  private circleIntersectsTriangle(
    centerX: number,
    centerY: number,
    radius: number,
    first: Point,
    second: Point,
    third: Point,
  ): boolean {
    if (this.pointInTriangle(centerX, centerY, first, second, third)) {
      return true;
    }

    return (
      this.circleIntersectsSegment(centerX, centerY, radius, first, second) ||
      this.circleIntersectsSegment(centerX, centerY, radius, second, third) ||
      this.circleIntersectsSegment(centerX, centerY, radius, third, first)
    );
  }

  private pointInTriangle(
    pointX: number,
    pointY: number,
    first: Point,
    second: Point,
    third: Point,
  ): boolean {
    const firstSide =
      (pointX - third.x) * (first.y - third.y) -
      (first.x - third.x) * (pointY - third.y);
    const secondSide =
      (pointX - first.x) * (second.y - first.y) -
      (second.x - first.x) * (pointY - first.y);
    const thirdSide =
      (pointX - second.x) * (third.y - second.y) -
      (third.x - second.x) * (pointY - second.y);
    const hasNegative = firstSide < 0 || secondSide < 0 || thirdSide < 0;
    const hasPositive = firstSide > 0 || secondSide > 0 || thirdSide > 0;
    return !(hasNegative && hasPositive);
  }

  private circleIntersectsSegment(
    centerX: number,
    centerY: number,
    radius: number,
    start: Point,
    end: Point,
  ): boolean {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const projection =
      ((centerX - start.x) * segmentX + (centerY - start.y) * segmentY) /
      segmentLengthSquared;
    const clampedProjection = Math.max(0, Math.min(1, projection));
    const closestX = start.x + segmentX * clampedProjection;
    const closestY = start.y + segmentY * clampedProjection;
    const dx = centerX - closestX;
    const dy = centerY - closestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  private collidesWithBicycle(bicycle: Sprite): boolean {
    for (const wheel of BICYCLE_WHEEL_COLLIDERS) {
      const center = this.bicycleLocalToWorld(bicycle, wheel);
      const dx = this.player.x - center.x;
      const dy = this.player.y - center.y;
      const collisionRadius = PLAYER_COLLISION_RADIUS + wheel.radius;
      if (dx * dx + dy * dy <= collisionRadius * collisionRadius) {
        return true;
      }
    }

    for (const [start, end] of BICYCLE_FRAME_SEGMENTS) {
      if (
        this.circleIntersectsSegment(
          this.player.x,
          this.player.y,
          PLAYER_COLLISION_RADIUS + BICYCLE_FRAME_COLLIDER_RADIUS,
          this.bicycleLocalToWorld(bicycle, start),
          this.bicycleLocalToWorld(bicycle, end),
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private bicycleLocalToWorld(bicycle: Sprite, point: Point): Point {
    const cosine = Math.cos(bicycle.rotation);
    const sine = Math.sin(bicycle.rotation);
    return {
      x: bicycle.x + point.x * cosine - point.y * sine,
      y: bicycle.y + point.x * sine + point.y * cosine,
    };
  }

  private handlePrimaryAction(): void {
    if (this.state === "game-over") {
      this.startGame(true);
      return;
    }

    if (this.state === "paused") {
      this.resumeGame();
      return;
    }

    this.jump();
  }

  private jump(): void {
    const audioReady = this.unlockAudio();
    if (this.isJumping) return;

    this.isJumping = true;
    this.playerVelocityY = JUMP_VELOCITY;
    void audioReady.then((ready) => {
      if (ready && this.state === "play") {
        this.playEffect("jump");
      }
    });
    this.setStatus("점프!");
  }

  private startGame(userInitiated: boolean): void {
    if (this.state === "play") return;

    this.state = "play";
    this.gameLayer.visible = true;
    this.pauseLayer.visible = false;
    this.gameOverLayer.visible = false;
    this.resetRound();
    this.setStatus("게임 시작. 탭 또는 아무 키를 눌러 아이스크림을 넘으세요.");

    if (userInitiated) {
      this.startRoundAudio();
    }
  }

  private resetRound(): void {
    const remaining = this.obstacleLayer.removeChildren();
    remaining.forEach((child) => child.destroy());
    this.obstacles = [];
    this.elapsed = 0;
    this.spawnElapsed = 0;
    this.hasSpawnedFirstIcecream = false;
    this.bicycleCheckElapsed = 0;
    this.hasSpawnedFirstBicycle = false;
    this.score = 0;
    this.playerVelocityY = 0;
    this.playerRollAngle = 0.34;
    this.gameOverFaceElapsed = 0;
    this.gameOverFace.rotation = 0;
    this.isJumping = false;
    this.player.position.set(PLAYER_X, playerGroundY());
    this.player.rotation = this.playerRollAngle;
    this.stopBgm();
    this.startCuePending = false;
    sound.stopAll();
    sound.speed("bgm", 1);
    this.updateCamera();
    this.player.visible = true;
    this.obstacleLayer.visible = true;
    this.scoreText.visible = true;
    this.pauseLayer.visible = false;
    this.scoreText.text = "0";
  }

  private pauseGame(): void {
    if (this.state !== "play") return;

    this.state = "paused";
    this.pauseActiveSounds();
    this.pauseLayer.visible = true;
    this.setStatus("일시정지되었습니다. 탭 또는 아무 키를 누르면 계속합니다.");
  }

  private resumeGame(): void {
    if (this.state !== "paused") return;

    this.state = "play";
    this.pauseLayer.visible = false;
    this.audioUnlocked = true;
    void this.resumeAudioContext().then((ready) => {
      if (ready && this.state === "play") {
        this.startBgm();
      }
    });
    this.setStatus("게임을 계속합니다.");
  }

  private endGame(): void {
    if (this.state !== "play") return;

    this.state = "game-over";
    this.stopBgm();
    this.playEffect("die");
    this.pauseLayer.visible = false;
    this.gameOverFaceElapsed = 0;
    this.gameOverFace.rotation = 0;
    this.bestScore = Math.max(this.bestScore, this.score);
    this.persistBestScore();
    this.gameOverScoreText.text = `점수 ${this.score}`;
    this.gameOverBestText.text = `최고 ${this.bestScore}`;
    this.gameOverLayer.visible = true;
    this.setStatus(
      `게임 오버. 점수 ${this.score}, 최고 점수 ${this.bestScore}. 탭하면 다시 시작합니다.`,
    );
  }

  private unlockAudio(): Promise<boolean> {
    const firstUnlock = !this.audioUnlocked;
    this.audioUnlocked = true;
    return this.resumeAudioContext().then((ready) => {
      if (!ready || this.state !== "play") {
        return false;
      }

      if (firstUnlock) {
        this.playStartCue();
      } else if (!this.startCuePending) {
        this.startBgm();
      }

      return true;
    });
  }

  private startRoundAudio(): void {
    this.audioUnlocked = true;
    void this.resumeAudioContext().then((ready) => {
      if (ready && this.state === "play") {
        this.playStartCue();
      }
    });
  }

  private playEffect(name: EffectSoundName): void {
    if (!this.audioUnlocked) return;

    const playback = sound.play(name, { singleInstance: true });
    if (playback instanceof Promise) {
      void playback.catch((error: unknown) => this.handleAudioError(error));
    }
  }

  private playStartCue(): void {
    if (!this.audioUnlocked || this.state !== "play") {
      return;
    }

    this.startCuePending = true;
    sound.stop("start");
    const playback = sound.play("start", {
      singleInstance: true,
      complete: () => {
        this.startCuePending = false;
        if (this.state === "play") {
          this.startBgm();
        }
      },
    });

    if (playback instanceof Promise) {
      void playback.catch((error: unknown) => {
        this.startCuePending = false;
        this.handleAudioError(error);
        if (this.state === "play") {
          this.startBgm();
        }
      });
    }
  }

  private startBgm(): void {
    if (
      !this.audioUnlocked ||
      this.state !== "play" ||
      this.startCuePending ||
      this.bgmInstance ||
      this.bgmStarting
    ) {
      return;
    }

    const requestId = ++this.bgmRequestId;
    this.bgmStarting = true;
    sound.stop("bgm");
    sound.speed("bgm", this.getSpeedMultiplier());
    const playback = sound.play("bgm", {
      loop: true,
      singleInstance: true,
    });

    if (playback instanceof Promise) {
      void playback
        .then((instance) => this.registerBgmInstance(instance, requestId))
        .catch((error: unknown) => {
          if (requestId === this.bgmRequestId) {
            this.bgmStarting = false;
          }
          this.handleAudioError(error);
        });
      return;
    }

    this.registerBgmInstance(playback, requestId);
  }

  private registerBgmInstance(
    instance: IMediaInstance,
    requestId: number,
  ): void {
    if (
      requestId !== this.bgmRequestId ||
      !this.audioUnlocked ||
      this.state !== "play"
    ) {
      instance.stop();
      return;
    }

    this.bgmStarting = false;
    this.bgmInstance?.stop();
    this.bgmInstance = instance;
    instance.once("stop", () => {
      if (this.bgmInstance === instance) {
        this.bgmInstance = null;
      }
    });
  }

  private stopBgm(): void {
    this.bgmRequestId += 1;
    this.bgmStarting = false;
    const instance = this.bgmInstance;
    this.bgmInstance = null;
    instance?.stop();
    sound.stop("bgm");
  }

  private resumeAudioContext(): Promise<boolean> {
    if (!sound.supported) {
      sound.resumeAll();
      return Promise.resolve(true);
    }

    const audioContext = sound.context.audioContext;
    if (audioContext.state === "running") {
      sound.resumeAll();
      return Promise.resolve(true);
    }

    if (this.audioResumePromise) {
      return this.audioResumePromise;
    }

    // Call resume synchronously from the tap/key handler, then wait before
    // creating one-shot sources. Safari otherwise can drop the first sound.
    this.audioResumePromise = audioContext
      .resume()
      .then(() => {
        if (this.state !== "play") {
          sound.pauseAll();
          return false;
        }

        sound.resumeAll();
        return true;
      })
      .catch((error: unknown) => {
        this.handleAudioError(error);
        return false;
      })
      .finally(() => {
        this.audioResumePromise = null;
      });

    return this.audioResumePromise;
  }

  private pauseActiveSounds(): void {
    if (!this.audioUnlocked) {
      return;
    }

    this.startCuePending = false;
    this.stopBgm();
    (Object.keys(SOUND_SOURCES) as SoundName[])
      .filter((name): name is EffectSoundName => name !== "bgm")
      .forEach((name) => sound.stop(name));
    sound.pauseAll();
  }

  private handleAudioError(error: unknown): void {
    console.warn("오디오를 재생할 수 없습니다.", error);
    this.setStatus(
      "소리를 재생하지 못했습니다. 다음 입력에서 다시 시도합니다.",
    );
  }

  private dismissBootSplash(): void {
    if (this.bootDismissed) return;

    this.bootDismissed = true;
    // Removing the layer avoids a stale red compositing surface on iOS Safari.
    this.bootSplash.setAttribute("aria-hidden", "true");
    this.bootSplash.remove();
  }

  private layoutWorld(): void {
    const { width, height } = this.app.screen;
    if (width === this.lastScreenWidth && height === this.lastScreenHeight) {
      return;
    }

    this.lastScreenWidth = width;
    this.lastScreenHeight = height;
    // Keep the full horizontal game field visible at every aspect ratio. A
    // portrait screen therefore reveals more of the vertical world instead
    // of cutting off the left and right sides of the 1920px composition.
    const scale = width / GAME_WIDTH;
    this.viewportHeight = height / scale;
    this.viewportTop = (GAME_HEIGHT - this.viewportHeight) / 2;
    this.redrawViewport();
    this.world.scale.set(scale);
    this.world.position.set(0, -this.viewportTop * scale);
  }

  private redrawViewport(): void {
    const rampBottom = Math.max(
      RAMP_BOTTOM_Y,
      playerGroundY() + this.viewportHeight / 2 + 64,
    );

    this.backdrop
      .clear()
      .rect(0, this.viewportTop, GAME_WIDTH, this.viewportHeight)
      .fill({ color: COLORS.canvas });
    this.sceneMask
      .clear()
      .rect(0, this.viewportTop, GAME_WIDTH, this.viewportHeight)
      .fill({ color: COLORS.canvas });
    this.ramp
      .clear()
      .moveTo(0, slopeY(0))
      .lineTo(GAME_WIDTH, slopeY(GAME_WIDTH))
      .lineTo(GAME_WIDTH, rampBottom)
      .lineTo(0, rampBottom)
      .closePath()
      .fill({ color: COLORS.ramp });
    this.pauseDimmer
      .clear()
      .rect(0, this.viewportTop, GAME_WIDTH, this.viewportHeight)
      .fill({ color: COLORS.overlay, alpha: 0.74 });
    this.gameOverDimmer
      .clear()
      .rect(0, this.viewportTop, GAME_WIDTH, this.viewportHeight)
      .fill({ color: COLORS.overlay, alpha: 0.56 });
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }

  private persistBestScore(): void {
    try {
      localStorage.setItem("rolling-root-best-score", String(this.bestScore));
    } catch {
      // Private browsing can deny storage; the in-memory score still works.
    }
  }

  public loadBestScore(): void {
    try {
      this.bestScore =
        Number.parseInt(
          localStorage.getItem("rolling-root-best-score") ?? "0",
          10,
        ) || 0;
    } catch {
      this.bestScore = 0;
    }
  }
}

async function main(): Promise<void> {
  const mount = document.querySelector<HTMLElement>("#game");
  const bootSplash = document.querySelector<HTMLElement>("#boot-splash");
  const status = document.querySelector<HTMLElement>("#game-status");

  if (!mount || !bootSplash || !status) {
    throw new Error("게임을 초기화할 HTML 요소를 찾지 못했습니다.");
  }

  const game = new RollingRootGame(mount, bootSplash, status);
  game.loadBestScore();
  await game.init();
}

void main().catch((error: unknown) => {
  const bootSplash = document.querySelector<HTMLElement>("#boot-splash");
  const bootError = document.querySelector<HTMLElement>("#boot-error");
  const mount = document.querySelector<HTMLElement>("#game");
  const status = document.querySelector<HTMLElement>("#game-status");
  if (bootSplash) bootSplash.classList.add("has-error");
  if (bootError) bootError.hidden = false;
  if (mount) mount.setAttribute("aria-busy", "false");
  if (status) {
    status.textContent =
      "게임을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.";
  }
  console.error(error);
});
