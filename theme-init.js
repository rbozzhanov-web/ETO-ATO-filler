// Runs before either page's stylesheet block ever paints, so the crew's chosen
// (or OS-preferred) theme is on the <html> element from the first frame — the
// two pages otherwise start on the hardcoded dark markup and only correct it
// once app.js/journey-log.js finish loading, which is what showed as a flash
// of the wrong theme on every crossing between them.
// The browser's own colour for the page — what iPadOS paints around and behind
// it before the page draws anything — follows the same choice: the light page's
// background when it is light, rather than the dark one the markup starts on.
// So does the colour scheme WebKit is told the page uses, which decides what
// it draws for the page itself: a dark theme gets dark pickers and menus, not
// a white aerodrome list opening in a dark cockpit.
try{
  var t = localStorage.getItem('etofill:theme');
  if(!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if(t === 'light'){
    document.documentElement.setAttribute('data-theme', 'light');
    var tc = document.querySelector('meta[name=theme-color]');
    if(tc) tc.setAttribute('content', '#f2f5f8');
    var cs = document.querySelector('meta[name=color-scheme]');
    if(cs) cs.setAttribute('content', 'light');
  }
}catch(e){}

// A cold start of the installed app — iPadOS has had its launch screen up, in
// the launch screen's dark, until the page draws. The page then comes up out
// of that same dark (index.html, html[data-launch]) rather than being switched
// on at once: in the light theme, at night, a bright page snapping on in a dark
// cockpit. Not on a crossing from the Journey Log, which arrives from a page
// of its own and no launch screen, nor on a reload, which has none either.
try{
  var standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var kind = nav ? nav.type : (performance.navigation && performance.navigation.type === 1 ? 'reload' : 'navigate');
  var fromHere = document.referrer && document.referrer.indexOf(location.origin + '/') === 0;
  if(standalone && kind === 'navigate' && !fromHere){
    var root = document.documentElement;
    root.setAttribute('data-launch', '');
    // Lifted once the page is ready to be seen — at once for a page with no
    // flight to reopen; for one with a flight, app.js lifts it once the flight
    // is back (resumeSession). And only once a frame has actually been drawn:
    // until then WebKit's animation clock stands where it was when loading
    // began, so a fade started any earlier counts as long over by the time the
    // first frame appears. That first frame shows the cover itself, in the
    // launch screen's own colour; the fade runs from the next.
    window.liftLaunch = function(){
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        if(root.getAttribute('data-launch') === '') root.setAttribute('data-launch', 'out');
      }); });
    };
    document.addEventListener('DOMContentLoaded', function(){
      if(!root.hasAttribute('data-resuming')) window.liftLaunch();
    });
  }
}catch(e){}

// A flight left open on the OFP page is reopened as soon as app.js loads. Until
// it is back on screen the page says so, instead of painting the empty load
// screen first and then jumping to the plan. app.js clears this either way.
try{
  if(!/journey-log\.html$/.test(location.pathname) && localStorage.getItem('etofill:last'))
    document.documentElement.setAttribute('data-resuming', '');
}catch(e){}

// Never shown inside another site's frame. The policy that would forbid it,
// frame-ancestors, cannot be set from a <meta> tag and GitHub Pages sends no
// headers of its own — so a framing page could lay its own controls over this
// one and steer a crew's taps. Framed, the page stays blank and asks to be
// opened at the top level instead.
if (window.top !== window.self){
  document.documentElement.style.display = 'none';
  try { window.top.location = window.self.location.href; } catch(e){}
}
