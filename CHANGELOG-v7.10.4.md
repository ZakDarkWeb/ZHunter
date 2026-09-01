# ZHunter PRO v7.10.4

## Minimized-widget interaction hotfix

The minimized image widget no longer relies on the browser-generated click event to restore the full card. Pointer-up now handles deliberate taps, while native click activation is canceled. This prevents a drag or click-and-hold gesture anywhere on the minimized card from reopening the full card.

The existing pointer-capture drag flow remains active, so the minimized ZHunter widget can be moved freely and its position continues to be remembered.

## Verification

All main JavaScript files pass syntax checks. Release validation and Amazon/Walmart/Sam’s Club image-card DOM tests pass. Queue tests pass, and the expanded regression suite passes 35 checks.
