'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { briefPage, attachmentTitle, groupAttachments, briefSections } = require('../ofp-core.js');

/* What a package carries beyond what the app sets out itself is listed, so it is
   noticed: the documents attached behind the OFP, and the brief's own sections.
   Found by the package's shape, not by a list of names — a section or an
   attachment the airline adds later is listed the same way. The lines below
   follow a real Air Astana package's layout; none of its content is used. */

test('the brief marks its own pages; an attachment does not', () => {
  assert.equal(briefPage([{ str: 'AIR ASTANA BRIEF PAGE 7 OF 80' }]), true);
  assert.equal(briefPage([{ str: 'PAGE 7 OF 80' }]), true);
  assert.equal(briefPage([{ str: 'DXB OPERATIONAL BRIEFING' }, { str: 'MAN003-26page1of 3' }]), false);
});

test('an attachment is titled by its largest type near the top, in drawing order', () => {
  // A proportional font drawn a few glyphs at a time, out of x order.
  const items = [
    { str: 'DXB OPER', y: 780, size: 12 }, { str: 'ATIONAL BRIEFING', y: 780, size: 12 },
    { str: '1. Purpose', y: 700, size: 10 }, { str: 'Footer text', y: 30, size: 14 }];
  assert.equal(attachmentTitle(items, 842), 'DXB OPERATIONAL BRIEFING');
  assert.equal(attachmentTitle([{ str: '\u0000x', y: 800, size: 12 }], 842), null, 'nothing readable, no title');
});

test('attached pages run together while they follow on at one page size', () => {
  const brief = { brief: true, size: '612x792' };
  const att = (size, title) => ({ brief: false, size, title });
  const pages = [brief, brief, att('792x612', 'DE-ICING STATUS'), att('842x595', 'OM-C 13.4'),
                 att('842x595', 'NON-ESCALATION'), att('595x842', 'DXB BRIEFING'), att('595x842', null),
                 att('595x842', 'MANDATORY READ'), att('595x842', null)];
  assert.deepEqual(groupAttachments(pages, new Set([7, 8])), [
    { pages: [2], title: 'DE-ICING STATUS' },
    { pages: [3, 4], title: 'OM-C 13.4' },
    { pages: [5, 6], title: 'DXB BRIEFING' }]);
});

test('the brief’s sections are found by how it sets its headings', () => {
  const L = (page, ...texts) => texts.map(text => ({ page, text }));
  const lines = [
    ...L(0, '--- AIR ASTANA OPERATIONAL FLIGHT PLAN ---', 'FLT AC/REG DATE'),
    ...L(1, 'ADDITIONAL FUEL BREAK DOWN', '-----------------------------',
         'TO AWY FL MT WIND TAS', '----- ---- ------- --------',       // a table header: not a section
         '------ 28 N2518.5 E05623.7 699 05 ---/092 0 0.12 20286 ....'), // a waypoint row: not one either
    ...L(6, 'START OF WIND AND TEMPERATURE SUMMARY OMDB TO UAAA', '--------------------'),
    ...L(7, 'END OF WIND AND TEMPERATURE SUMMARY OMDB TO UAAA', '--------------------'),
    ...L(9, '--- OVERFLIGHT PERMITS', 'START OF ICAO FLIGHT PLAN'),
    ...L(10, 'NO SIGMET REPORTS FOUND WITHIN TIME SPECIFIED', 'DEPARTURE: DUBAI INTL',
         'NO TAF REPORTS FOUND FOR UZFF'),                                // one aerodrome's: not a section
    ...L(12, 'SIGMET UAII 230800Z VALID 0800/1200 SEV TURB'),
    ...L(18, 'STATION COMPANY NOTAMS', 'ADMIN COMPANY NOTAMS'),
    ...L(43, 'Fir: OMAE Region: EMIRATES'),
    ...L(50, '--- SECURITY ADVISORY ---')];                                // one added later: listed too
  assert.deepEqual(briefSections(lines).map(s => `${s.page + 1} ${s.title}`), [
    '1 AIR ASTANA OPERATIONAL FLIGHT PLAN', '2 ADDITIONAL FUEL BREAK DOWN',
    '7 WIND AND TEMPERATURE SUMMARY OMDB TO UAAA', '10 OVERFLIGHT PERMITS', '10 ICAO FLIGHT PLAN',
    '11 SIGMET — none found', '11 Aerodrome weather and NOTAMs', '13 SIGMET reports',
    '19 Company NOTAMs', '44 FIR NOTAMs', '51 SECURITY ADVISORY']);
});
