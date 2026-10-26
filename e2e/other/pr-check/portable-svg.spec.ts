import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixturePath } from '../../helpers/mmd-snapshots.ts';
import { imgSnapshotTest } from '../../helpers/util.ts';

// One existing fixture per diagram type, rendered with portableSvg.
const FIXTURES = [
  'agentflow/pr-check/1-should-render-nested-flow-containers.mmd',
  'architecture/pr-check/should-render-an-architecture-diagram-with-edge-labels.mmd',
  'block/pr-check/hexagon-shape-block-should-span-correctly.mmd',
  'c4/pr-check/c4-1-should-render-a-simple-c4context-diagram.mmd',
  'class-diagram/pr-check/16b-should-handle-the-direction-statement-with-tb-2.mmd',
  'cynefin/pr-check/should-render-a-cynefin-diagram-with-transitions.mmd',
  'er-diagram/pr-check/1433-should-render-a-simple-er-diagram-with-a-title.mmd',
  'eventmodeling/pr-check/state-change-pattern.mmd',
  'flowchart/pr-check/12-should-render-a-flowchart-with-long-names-and-class-definitions.mmd',
  'gantt/pr-check/multiple-dependencies-syntax.mmd',
  'git/pr-check/11-should-render-a-gitgraph-with-cherry-pick-commit-with-custom-tag.mmd',
  'ishikawa/pr-check/12-should-render-correctly-when-effect-is-indented-more-than-causes.mmd',
  'journey/pr-check/dark-theme.mmd',
  'kanban/pr-check/10-full-example.mmd',
  'mindmap/pr-check/1-tidy-tree-should-render-a-simple-mindmap-without-children.mmd',
  'packet/pr-check/should-render-a-complex-packet-diagram.mmd',
  'pie/pr-check/should-render-a-donut-diagram.mmd',
  'quadrant-chart/pr-check/it-should-render-data-points-with-styles-classes.mmd',
  'radar/pr-check/should-handle-radar-diagram-with-radar-style-override.mmd',
  'railroad/pr-check/abnf-alternation-and-repetition.mmd',
  'requirement/pr-check/sample.mmd',
  'sankey/pr-check/should-render-a-simple-example.mmd',
  'sequence/pr-check/should-handle-complex-interactions-between-different-participant-types.mmd',
  'state-diagram-v2/pr-check/can-have-styles-applied.mmd',
  'swimlanes/pr-check/10-node-placement.mmd',
  'timeline/pr-check/12-should-render-timeline-with-proper-vertical-line-lengths-for-all-columns.mmd',
  'treemap/pr-check/10-should-render-the-example-from-documentation.mmd',
  'tree-view/pr-check/should-pick-file-icons-from-filename-and-extension-config-maps.mmd',
  'usecase/pr-check/complete-hand-drawn-rendering-contract.mmd',
  'venn/pr-check/11-should-render-a-venn-diagram-with-custom-text-colors-via-style.mmd',
  'wardley/pr-check/1-should-render-tea-shop.mmd',
  'xychart/pr-check/decimals-and-negative-numbers-are-supported.mmd',
];

test.describe('portableSvg', () => {
  for (const fixture of FIXTURES) {
    test(fixture.split('/')[0], async ({ page }, testInfo) => {
      await imgSnapshotTest(
        page,
        testInfo,
        readFileSync(fixturePath(fixture), 'utf8'),
        { portableSvg: true },
        false,
        async (svg) => {
          await expect(svg.locator('style')).toHaveCount(0);
          await expect(svg.locator('foreignObject')).toHaveCount(0);
          const styled = await svg.evaluate((el) =>
            [...el.querySelectorAll('[style]')].map((e) => e.outerHTML.slice(0, 300))
          );
          expect(styled).toEqual([]);
          const markup = await svg.evaluate((el) => new XMLSerializer().serializeToString(el));
          expect(markup).not.toMatch(/hsla?\(|dominant-baseline|alignment-baseline/);
          const parseError = await page.evaluate(
            (xml) =>
              new DOMParser().parseFromString(xml, 'image/svg+xml').querySelector('parsererror')
                ?.textContent,
            markup
          );
          expect(parseError).toBeUndefined();
        }
      );
    });
  }
});
