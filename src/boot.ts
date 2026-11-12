/** Picks the 2.5D game or the 3D spike. The 2.5D module is unchanged. */
export {}

if (new URLSearchParams(location.search).get('mode') === '3d') {
  document.documentElement.classList.add('spike3d');
  await import('./spike3d/boot.ts');
} else {
  await import('./main.ts');
}
