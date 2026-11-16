// Input: pointer lock, key state, click routing to the game, and the shop
// buttons. Exposes a plain state object the fixed-step sim samples, plus the
// per-frame mouse deltas the look code consumes.

export function createInput(canvas, hooks) {
  const state = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    walkHold: false,
    firing: false,
    locked: false,
    // Accumulated mouse deltas, consumed by the sim's look step.
    dx: 0,
    dy: 0,
    // One-shot presses, cleared by the consumer.
    reload: false,
    swap: 0, // 0 none, 1 rifle, 2 pistol, 3 grenade
    use: false,
    shop: false,
  };

  const keymap = {
    KeyW: 'forward',
    KeyS: 'back',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'jump',
    ControlLeft: 'crouch',
    ControlRight: 'crouch',
    ShiftLeft: 'walkHold',
    KeyE: 'use', // held: planting/defusing need the key down, not tapped
  };

  function onKeyDown(e) {
    if (e.code in keymap) {
      state[keymap[e.code]] = true;
      if (e.code === 'Space') e.preventDefault();
    }
    if (e.code === 'KeyR') state.reload = true;
    if (e.code === 'Digit1') state.swap = 1;
    if (e.code === 'Digit2') state.swap = 2;
    if (e.code === 'Digit3') state.swap = 3;
    if (e.code === 'KeyB') state.shop = true;
  }

  function onKeyUp(e) {
    if (e.code in keymap) state[keymap[e.code]] = false;
  }

  function onMouseMove(e) {
    if (state.locked) {
      state.dx += e.movementX;
      state.dy += e.movementY;
    }
  }

  function onMouseDown(e) {
    if (e.button === 0) {
      if (!state.locked) {
        canvas.requestPointerLock();
      } else if (hooks.onFirePress) {
        hooks.onFirePress();
      }
      state.firing = true;
    } else if (e.button === 2 && hooks.onFireAlt) {
      hooks.onFireAlt();
    }
  }

  function onMouseUp(e) {
    if (e.button === 0) state.firing = false;
  }

  function onLockChange() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      for (const k of Object.values(keymap)) state[k] = false;
      hooks.onUnlock?.();
    } else {
      hooks.onLock?.();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('contextmenu', onContextMenu);

  // Consume accumulated look deltas (called once per fixed tick).
  state.takeLook = () => {
    const dx = state.dx;
    const dy = state.dy;
    state.dx = 0;
    state.dy = 0;
    return [dx, dy];
  };

  state.dispose = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('contextmenu', onContextMenu);
  };

  return state;
}

// Wire the shop buttons inside the overlay card.
export function bindShopButtons(handler) {
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-item]');
    if (btn) handler(btn.dataset.item);
    else if (e.target.id === 'overlay' || e.target.id === 'overlay-card') handler('close');
  });
}
