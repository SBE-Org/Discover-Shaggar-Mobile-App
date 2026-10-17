// Branding shared by the mobile app and the admin portal: app name, tagline, colour and logo
// come from Settings → Branding, so the Bureau can change them without touching code.
import { createElement } from 'react';
import { logoSvg, setArtBrand } from './art.js';
import { RawSvg } from './util.js';

export const brand = { name: 'Discover Shaggar', tagline: 'Verified places across all 12 sub-cities', logo: '', hero: '', primary: '#C8102E' };

export function applyBrand(settings = {}) {
  brand.name = settings['site.name'] || brand.name;
  brand.tagline = settings['brand.tagline'] ?? brand.tagline;
  brand.logo = settings['brand.logo'] ? '/uploads/' + settings['brand.logo'] : '';
  brand.hero = settings['brand.hero'] ? '/uploads/' + settings['brand.hero'] : '';
  brand.primary = /^#[0-9a-f]{6}$/i.test(settings['brand.primary'] || '') ? settings['brand.primary'] : brand.primary;
  document.documentElement.style.setProperty('--brand', brand.primary);
  setArtBrand(brand.primary);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#141212';
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    if (brand.logo) { icon.href = brand.logo; icon.type = ''; }
    else { icon.href = 'data:image/svg+xml,' + encodeURIComponent(logoSvg(64)); icon.type = 'image/svg+xml'; }
  }
  return brand;
}

/** The logo: the uploaded image, or the default mark. */
export function Logo({ size = 40 }) {
  return brand.logo
    ? createElement('img', { src: brand.logo, alt: brand.name + ' logo', width: size, height: size })
    : createElement(RawSvg, { svg: logoSvg(size) });
}
