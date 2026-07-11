import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const sizes = [16, 32, 48, 96, 128];
const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const svg = await readFile(
  path.join(repositoryRoot, 'public/lens-logo.svg'),
  'utf8',
);
const outputDirectory = path.join(repositoryRoot, 'public/icon');

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.locator('svg').screenshot({
      path: path.join(outputDirectory, `${size}.png`),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
