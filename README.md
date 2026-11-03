# Blast Door

Point it at any web app. A browser agent QA-sweeps it inside throwaway Docker sandboxes on a Vultr VM, a vision judge grades every screenshot, an adversary tries to break every bug claim, and you get a repro report with receipts.

A hostile page tries to hijack the agent. The sandbox absorbs it: caps hit, no secrets inside, container destroyed, host untouched.

Built for Vultr Agent Rush (Nov 3 to Nov 8, 2026). Work in progress.

- Control plane: Vultr VM (Next.js app + API)
- All agent LLM calls: Vultr Serverless Inference
- Sandboxes: per-task Docker containers with Playwright, CPU, memory and wall-clock caps, egress limited to the target

License: MIT
