# Visual mode on host document entry

## Symptom and cause

The application defaults to Visual mode, but the NWU adapter restored a previously saved workspace mode and overrode that default with Source or Preview. The body-count feature did not alter the mode selection path.

## Change

Set each loaded host document's entry mode to Visual. Continue restoring the validated sidebar layout and draft/checkpoint data. Manual mode changes after entry still work and persist normally. Standalone behavior and the public SDK's explicit initial-mode option are unchanged.

## Verification

Before the fix, three assertions reproduced Source/Preview overriding Visual. After the fix, 28 focused persistence, app-shell, body-count and RGB paste tests pass in this repository and type checking passes. Tests cover all three stored modes, sidebar restoration, manual source selection and content preservation.

## Remaining limitations

Windows runtime validation was not performed. No other known issues.
