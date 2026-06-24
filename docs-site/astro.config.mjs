// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site: https://YuvalKandov.github.io/LiveStage/
  site: 'https://YuvalKandov.github.io',
  base: '/LiveStage/',
  integrations: [
    // Renders ```mermaid fenced blocks client-side (no browser dependency at build time).
    mermaid({
      theme: 'default',
      autoTheme: true,
    }),
    starlight({
      title: 'LiveStage',
      description:
        'A guided-integration iOS SDK and analytics service for configurable Live Activities (Lock Screen and Dynamic Island).',
      head: [
        {
          // Self-contained click-to-expand lightbox for all content images (no dependency).
          tag: 'script',
          content: `
            window.addEventListener('load', function () {
              var overlay = document.createElement('div');
              overlay.className = 'ls-lightbox';
              var big = document.createElement('img');
              big.alt = '';
              overlay.appendChild(big);
              overlay.addEventListener('click', function () { overlay.classList.remove('open'); });
              document.body.appendChild(overlay);
              document.addEventListener('click', function (e) {
                var img = e.target.closest('.sl-markdown-content img');
                if (!img) return;
                big.src = img.currentSrc || img.src;
                big.alt = img.alt || '';
                overlay.classList.add('open');
              });
              document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') overlay.classList.remove('open');
              });
            });
          `,
        },
      ],
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/YuvalKandov/LiveStage',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', link: '/' },
            { label: 'Quickstart', link: '/quickstart/' },
            { label: 'Getting started', link: '/getting-started/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Templates', link: '/templates/' },
            { label: 'API reference', link: '/api-reference/' },
            { label: 'Data model', link: '/data-model/' },
            { label: 'Widget Extension setup', link: '/widget-setup/' },
          ],
        },
        {
          label: 'Service and console',
          items: [
            { label: 'Developer console', link: '/console/' },
            { label: 'Analytics and metrics', link: '/analytics/' },
          ],
        },
      ],
    }),
  ],
});
