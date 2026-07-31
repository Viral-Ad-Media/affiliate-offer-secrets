// Applies the saved theme to <html> BEFORE first paint. This must be a blocking inline script in
// <head> — doing it in a useEffect would render the dark default first and flash on every load
// for light-mode users. Kept deliberately tiny and dependency-free for that reason.
//
// Stored preference (localStorage.theme) is "system" | "light" | "dark"; "system" (the default)
// follows prefers-color-scheme. Dark is the app's base styling, so only light needs a class.
const SCRIPT = `(function(){try{
var t=localStorage.getItem('theme')||'system';
var light=t==='light'||(t==='system'&&window.matchMedia('(prefers-color-scheme: light)').matches);
document.documentElement.classList.toggle('light',light);
}catch(e){}})();`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
