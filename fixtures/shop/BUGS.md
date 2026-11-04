# Planted bugs in Gearbox Supply

| id | where | bug | detectable by |
| --- | --- | --- | --- |
| S1 | `/` | Shop Lamp image is a 404 (broken media) | network failure + vision |
| S2 | `/` | Reviews widget calls `/api/reviews` which returns 500, then throws in the console | network + console |
| S3 | `/` | `trackClick is not defined` when the hero button is clicked | console error |
| S4 | `/` | Product grid is a fixed 4 x 260px, so mobile scrolls sideways | overflow probe + vision |
| S5 | `/` | Long product name overflows its card (`white-space: nowrap`) | vision |
| S6 | `/` | Promo banner text is dark blue on dark blue (contrast) | contrast audit + vision |
| S7 | `/` | Hex Driver Set image has no alt text | a11y audit |
| S8 | `/cart` | Subtotal drops the last item when there are two or more lines | agent flow + vision |
| S9 | `/checkout` | Email field accepts any text; a non 5 digit ZIP returns a 500 stack trace | agent flow |
| S10 | `/contact` | Name input has no label; form posts to a 404 | a11y audit + agent flow |
| S11 | `/returns` | Policy PDF link is broken | link check |
| S12 | footer | Careers link is broken | link check |
