import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getSections(markdown) {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)];

  return headings.map((heading, index) => {
    const level = heading[1].length;
    const nextHeading = headings.slice(index + 1).find((next) => next[1].length <= level);
    const start = heading.index + heading[0].length;
    const end = nextHeading?.index ?? markdown.length;

    return {
      title: heading[2].trim(),
      body: markdown.slice(start, end),
    };
  });
}

function isForbiddenDemoHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const localAddress =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const temporaryTunnel = [
    /(^|\.)ngrok\.io$/,
    /(^|\.)ngrok-free\.app$/,
    /(^|\.)trycloudflare\.com$/,
    /(^|\.)cfargotunnel\.com$/,
    /(^|\.)loca\.lt$/,
    /(^|\.)serveo\.net$/,
  ].some((pattern) => pattern.test(host));

  return localAddress || temporaryTunnel || host === "github.com";
}

export function getShippingReadmeIssues(markdown) {
  const issues = [];
  const sections = getSections(markdown);
  const intro = markdown.replace(/^\s*#.*(?:\r?\n)/, "").trimStart().split(/\r?\n\s*\r?\n/)[0] || "";

  if (intro.replace(/[^\p{L}\p{N}]/gu, "").length < 60) {
    issues.push("Add a clear project description near the top of README.md.");
  }
  if (!sections.some(({ title }) => /^(run|getting started|installation|how to (try|run)|try it)$/i.test(title))) {
    issues.push("Add a README section explaining how to try or run the project.");
  }
  if (!sections.some(({ title }) => /inspiration|why/i.test(title))) {
    issues.push("Add a README section about the project's inspiration or motivation.");
  }
  if (!sections.some(({ title }) => /technolog/i.test(title))) {
    issues.push("Add a README section listing the main technologies used.");
  }
  if (!/!\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/.test(markdown)) {
    issues.push("Add at least one project screenshot with descriptive alt text to README.md.");
  }

  const demo = sections.find(({ title }) => /^(live\s+)?demo$/i.test(title));
  if (!demo) {
    issues.push("Add a Live demo section with a permanent, publicly usable demo URL.");
  } else {
    const candidates = [...demo.body.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|(?<!\()https?:\/\/[^\s<>)]+/g)]
      .map((match) => (match[1] || match[0]).replace(/[.,;!?]+$/, ""));
    const validUrls = [];

    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" && !isForbiddenDemoHost(url.hostname)) {
          validUrls.push(url);
        } else {
          issues.push(`The demo URL must use permanent public HTTPS hosting, not ${url.hostname || candidate}.`);
        }
      } catch {
        issues.push("The Live demo section contains an invalid URL.");
      }
    }

    if (validUrls.length === 0 && candidates.length === 0) {
      issues.push("Add a permanent public HTTPS URL to the Live demo section.");
    }
  }

  return issues;
}

function main() {
  const issues = [];
  const readmePath = path.join(root, "README.md");
  if (!existsSync(readmePath)) {
    issues.push("README.md is missing.");
  } else {
    issues.push(...getShippingReadmeIssues(readFileSync(readmePath, "utf8")));
  }

  if (!["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].some((name) => existsSync(path.join(root, name)))) {
    issues.push("Add an open-source license file.");
  }

  if (issues.length > 0) {
    console.error("Shipping preflight failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log("Automated shipping preflight passed.");
  }

  console.log(
    "\nHuman review still required: confirm this is not a school project, prior " +
      "competition entry, or unmodified tutorial; no sandbox-only paywall is used; " +
      "the demo is easy to access and not hosted on a disallowed free tier; " +
      "project text and assets meet the guide's originality rules; and Kairos, " +
      "Hackatime, and the required commit cadence are maintained.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
