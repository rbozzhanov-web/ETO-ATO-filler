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
