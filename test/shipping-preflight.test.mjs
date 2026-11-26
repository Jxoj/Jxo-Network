import assert from "node:assert/strict";
import test from "node:test";
import { getShippingReadmeIssues } from "../scripts/check-hideout-shipping.mjs";

const completeReadme = `# Sample project

This is a clear description of a useful project with enough detail for a first-time visitor.

## Live demo

Try the [public demo](https://demo.example.org/).

## Run

Start the app with \`npm start\`.

## Inspiration

This project was created to solve a problem.

## Technologies

It uses JavaScript and Node.js.

![Dashboard screenshot](docs/dashboard.png)
`;

test("shipping README check accepts a hosted demo and complete project overview", () => {
  assert.deepEqual(getShippingReadmeIssues(completeReadme), []);
});

test("shipping README check rejects missing demo, screenshots, and project context", () => {
  const issues = getShippingReadmeIssues("# Sample\n\nA small project.");
  assert.ok(issues.some((issue) => issue.includes("Live demo")));
  assert.ok(issues.some((issue) => issue.includes("screenshot")));
  assert.ok(issues.some((issue) => issue.includes("inspiration")));
  assert.ok(issues.some((issue) => issue.includes("technologies")));
});

test("shipping README check rejects temporary tunnel demo links", () => {
  const readme = completeReadme.replace("https://demo.example.org/", "https://example.ngrok-free.app/");
  assert.ok(getShippingReadmeIssues(readme).some((issue) => issue.includes("permanent public HTTPS hosting")));
});

test("shipping README check rejects local and non-HTTPS demo links", () => {
  for (const url of ["http://demo.example.org/", "https://127.0.0.1/", "https://localhost/"]) {
    const readme = completeReadme.replace("https://demo.example.org/", url);
    assert.ok(getShippingReadmeIssues(readme).some((issue) => issue.includes("permanent public HTTPS hosting")));
  }
});
