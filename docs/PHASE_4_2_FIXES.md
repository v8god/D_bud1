# Phase 4.2 implementation notes

## Cursor tracking defect

`Live2DModel.focus(x, y)` accepts Pixi world-space coordinates. Phase 4.1 supplied normalized `[-1, 1]` values, so the effective target remained almost at the model centre. Phase 4.2 feeds the normalized values directly to the internal focus controller.

## Scheduler defect

The temporary state buttons supplied priority `110` to every requested state. The typing profile has no fixed duration, so selecting it created an indefinite priority-110 animation. Celebration (`80`) and notification (`78`) could not interrupt it. Phase 4.2 lets each state use its configured profile priority.

## Keyboard activity privacy

The native Windows command uses `GetAsyncKeyState` only to answer whether a typing-related key is active. It returns one boolean and never returns key codes or text. The frontend starts a typing session on activity and ends it after a short inactivity delay.

## Keyboard layering and placement

The keyboard is now appended after the Live2D model in the Pixi stage, making it a foreground prop. Its centre is positioned at 50% of the model's visible height instead of using a lower-body top coordinate.
