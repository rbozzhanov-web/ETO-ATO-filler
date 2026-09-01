'use strict';

// Synthetic, anonymised OFP references. They deliberately use airport/waypoint-like
// identifiers but contain no operational flight data. Each fixture freezes a small
// plan and the outputs independently checked when the fixture was added. A change
// in the arithmetic therefore has to explain why these reference answers moved.
module.exports = [
  {
    name: 'short sector uses TOC altimeter fallback',
    takeoff: '0615', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:18 },
      { i:2, sec:1, wp:'P01',  cum:52 },
      { i:3, sec:1, wp:'BBBB', cum:88 }
    ],
    expected: { arrival:'0743', altimeter:[{ mark:18, wp:'TOC', label:'TOC' }] }
  },
  {
    name: 'two hour sector raises one hourly check',
    takeoff: '1010', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:20 },
      { i:2, sec:1, wp:'P10',  cum:65 },
      { i:3, sec:1, wp:'BBBB', cum:120 }
    ],
    expected: { arrival:'1210', altimeter:[{ mark:60, wp:'P10', label:'+1:00' }] }
  },
  {
    name: 'three hour sector raises two hourly checks',
    takeoff: '1415', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:22 },
      { i:2, sec:1, wp:'P20',  cum:72 },
      { i:3, sec:1, wp:'P21',  cum:128 },
      { i:4, sec:1, wp:'BBBB', cum:180 }
    ],
    expected: { arrival:'1715', altimeter:[{ mark:60, wp:'P20', label:'+1:00' }, { mark:120, wp:'P21', label:'+2:00' }] }
  },
  {
    name: 'arrival wraps through midnight',
    takeoff: '2310', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:25 },
      { i:2, sec:1, wp:'P30',  cum:80 },
      { i:3, sec:1, wp:'P31',  cum:145 },
      { i:4, sec:1, wp:'BBBB', cum:205 }
    ],
    expected: { arrival:'0235', altimeter:[{ mark:60, wp:'P30', label:'+1:00' }, { mark:120, wp:'P31', label:'+2:00' }] }
  },
  {
    name: 'alternate starts at destination arrival',
    takeoff: '2040', withAltn: true,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:20 },
      { i:2, sec:1, wp:'P40',  cum:75 },
      { i:3, sec:1, wp:'BBBB', cum:135 },
      { i:4, sec:2, wp:'A40',  cum:18 },
      { i:5, sec:2, wp:'CCCC', cum:42 }
    ],
    expected: {
      arrival:'2255',
      alternate:[{ wp:'A40', eto:'2313' }, { wp:'CCCC', eto:'2337' }],
      altimeter:[{ mark:60, wp:'P40', label:'+1:00' }]
    }
  },
  {
    name: 'alternate can itself cross midnight',
    takeoff: '2200', withAltn: true,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:18 },
      { i:2, sec:1, wp:'P50',  cum:70 },
      { i:3, sec:1, wp:'BBBB', cum:115 },
      { i:4, sec:2, wp:'A50',  cum:20 },
      { i:5, sec:2, wp:'CCCC', cum:55 }
    ],
    expected: {
      arrival:'2355',
      alternate:[{ wp:'A50', eto:'0015' }, { wp:'CCCC', eto:'0050' }],
      altimeter:[{ mark:60, wp:'P50', label:'+1:00' }]
    }
  },
  {
    name: 'long sector keeps checks out of final hour',
    takeoff: '0430', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:24 },
      { i:2, sec:1, wp:'P60',  cum:66 },
      { i:3, sec:1, wp:'P61',  cum:126 },
      { i:4, sec:1, wp:'P62',  cum:186 },
      { i:5, sec:1, wp:'P63',  cum:246 },
      { i:6, sec:1, wp:'BBBB', cum:310 }
    ],
    expected: {
      arrival:'0940',
      altimeter:[
        { mark:60, wp:'P60', label:'+1:00' },
        { mark:120, wp:'P61', label:'+2:00' },
        { mark:180, wp:'P62', label:'+3:00' },
        { mark:240, wp:'P63', label:'+4:00' }
      ]
    }
  },
  {
    name: 'dense waypoints still map hourly checks to first waypoint after mark',
    takeoff: '0905', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:16 },
      { i:2, sec:1, wp:'P70',  cum:44 },
      { i:3, sec:1, wp:'P71',  cum:61 },
      { i:4, sec:1, wp:'P72',  cum:95 },
      { i:5, sec:1, wp:'P73',  cum:123 },
      { i:6, sec:1, wp:'BBBB', cum:190 }
    ],
    expected: { arrival:'1215', altimeter:[{ mark:60, wp:'P71', label:'+1:00' }, { mark:120, wp:'P73', label:'+2:00' }] }
  },
  {
    name: 'direct reference skips every intermediate waypoint',
    takeoff: '0730', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:20 },
      { i:2, sec:1, wp:'P80',  cum:55 },
      { i:3, sec:1, wp:'P81',  cum:90 },
      { i:4, sec:1, wp:'P82',  cum:125 },
      { i:5, sec:1, wp:'BBBB', cum:165 }
    ],
    direct: { currentIndex:1, targetIndex:5, alreadySkipped:[] },
    expected: {
      arrival:'1015',
      directSkipped:[2,3,4],
      altimeter:[{ mark:60, wp:'P81', label:'+1:00' }]
    }
  },
  {
    name: 'direct reference preserves a waypoint already skipped earlier',
    takeoff: '1635', withAltn: false,
    plan: [
      { i:0, sec:1, wp:'AAAA', cum:0 },
      { i:1, sec:1, wp:'TOC',  cum:18 },
      { i:2, sec:1, wp:'P90',  cum:50 },
      { i:3, sec:1, wp:'P91',  cum:85 },
      { i:4, sec:1, wp:'P92',  cum:120 },
      { i:5, sec:1, wp:'BBBB', cum:155 }
    ],
    direct: { currentIndex:1, targetIndex:5, alreadySkipped:[3] },
    expected: {
      arrival:'1910',
      directSkipped:[2,4],
      altimeter:[{ mark:60, wp:'P91', label:'+1:00' }]
    }
  }
];
