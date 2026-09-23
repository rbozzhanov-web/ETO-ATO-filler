// Runs before either page's stylesheet block ever paints, so the crew's chosen
// (or OS-preferred) theme is on the <html> element from the first frame — the
// two pages otherwise start on the hardcoded dark markup and only correct it
// once app.js/journey-log.js finish loading, which is what showed as a flash
// of the wrong theme on every crossing between them.
try{
  var t = localStorage.getItem('etofill:theme');
  if(!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if(t === 'light') document.documentElement.setAttribute('data-theme', 'light');
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
