# TypeScript on Node.js, not Python

The prototype (`prototypes/network-projects/PROTOTYPE-faultwitness.html`) planned to port its logic to `diagnoser.py` and `agent.py`. We build in TypeScript on Node.js instead, because the diagnosis logic already exists as JavaScript in the prototype's `<script id="logic">` and ports with types rather than being rewritten, and Node ships `fetch`, `dns`, `net` and `tls` without dependencies. That saves an estimated one to two hours of a one-day budget.
