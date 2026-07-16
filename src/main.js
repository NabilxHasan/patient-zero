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
  const game = new Phaser.Game(config);
  window.game = game;

  // --- Focus/visibility resilience -----------------------------------------
  // Browsers pause requestAnimationFrame when a tab is hidden or the window
  // loses focus. Without handling, that reads as a hard freeze. Instead we
  // pause the gameplay legibly and guarantee a clean resume.
  const overlay = document.createElement('div');
  overlay.id = 'pauseOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'display:none',
    'align-items:center', 'justify-content:center',
    'background:rgba(4,6,12,0.82)', 'z-index:50', 'cursor:pointer',
    'font-family:Consolas,"Courier New",monospace', 'text-align:center',
    '-webkit-user-select:none', 'user-select:none',
  ].join(';');
  overlay.innerHTML =
    '<div><div style="color:#49ff8c;font-size:44px;font-weight:bold;letter-spacing:2px;' +
    'text-shadow:0 0 24px #1a7a44">PAUSED</div>' +
    '<div style="color:#9ca3af;font-size:18px;margin-top:14px">tab lost focus — ' +
    'click or press any key to resume</div></div>';
  document.body.appendChild(overlay);

  const inGame = () => game.scene.isActive('game') || game.scene.isPaused('game');

  function pause() {
    if (!inGame() || game.scene.isPaused('game')) return;
    game.scene.pause('game');
    if (game.scene.getScene('ui')) game.scene.pause('ui');
    overlay.style.display = 'flex';
  }

  function resume() {
    overlay.style.display = 'none';
    game.loop.wake();            // restart the timestep if the browser paused it
    if (game.scene.isPaused('game')) game.scene.resume('game');
    if (game.scene.isPaused('ui')) game.scene.resume('ui');
    if (window.AudioFX) AudioFX.resume();
  }

  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause(); else resume();
  });
  overlay.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', () => { if (overlay.style.display !== 'none') resume(); });

  // Watchdog: if the page is visible but the loop has silently stalled
  // (some browsers freeze rAF without a visibility event), kick it awake.
  let lastFrame = 0, stalls = 0;
  setInterval(() => {
    if (document.hidden || overlay.style.display !== 'none') { lastFrame = game.loop.frame; return; }
    if (game.loop.frame === lastFrame) {
      if (++stalls >= 2) { game.loop.wake(); stalls = 0; }
    } else { stalls = 0; }
    lastFrame = game.loop.frame;
  }, 1000);
});
