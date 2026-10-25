// Example Veneer component: a star rating in place of a one-digit input field.
//
// Use it on a field (Show as: Component). Options:
//   max  the number of stars (default 5)
//
// Clicking a star (or using the arrow keys) types its number into the field,
// like the user typing it; the value is sent with the next key, as usual.

export const label = 'Star rating';

const maxOf = (ctx) => Math.min(10, Math.max(1, Number(ctx.options.max) || 5));

export function mount(element, ctx) {
  let current = ctx;
  let stars = [];
  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Rating');
  group.style.cssText = 'display: flex; align-items: center; height: 100%; gap: 2px;';
  group.addEventListener('keydown', (e) => {
    const value = Number(current.value) || 0;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? value + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? value - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = Math.min(stars.length, Math.max(1, next));
    current.setValue?.(String(n));
    stars[n - 1].focus();
  });
  element.append(group);

  /** One button per star; rebuilt when the max option changes. */
  const build = () => {
    const max = maxOf(current);
    stars = Array.from({ length: max }, (_, i) => {
      const star = document.createElement('button');
      star.type = 'button';
      star.setAttribute('role', 'radio');
      star.setAttribute('aria-label', `${i + 1} of ${max}`);
      star.textContent = '★';
      star.style.cssText = 'border: 0; background: none; padding: 0 1px; font-size: 1.25em; line-height: 1; cursor: pointer;';
      star.addEventListener('click', () => current.setValue?.(String(i + 1)));
      return star;
    });
    group.replaceChildren(...stars);
  };
  const show = () => {
    if (stars.length !== maxOf(current)) build();
    const value = Number(current.value) || 0;
    stars.forEach((star, i) => {
      star.style.color = i < value ? 'var(--warning, #d97706)' : 'var(--border, #ccc)';
      star.setAttribute('aria-checked', String(i + 1 === value));
      // One tab stop: the chosen star, else the first.
      star.tabIndex = i + 1 === (value || 1) ? 0 : -1;
    });
  };
  show();
  return {
    update(next) {
      current = next;
      show();
    },
  };
}
