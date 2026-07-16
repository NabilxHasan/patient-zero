// Game bootstrap.
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0a0c10',
  roundPixels: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, UIScene, EndScene],
};

window.addEventListener('load', () => {
  // Headless/hidden contexts (dev preview panes) never fire requestAnimationFrame;
  // fall back to a timer-driven loop there so the game still runs.
  if (document.hidden) config.fps = { forceSetTimeOut: true, target: 60 };
  window.game = new Phaser.Game(config);
});
