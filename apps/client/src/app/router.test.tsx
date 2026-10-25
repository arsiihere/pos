import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHashRoute } from './router';

function Show() {
  return <p>{useHashRoute()}</p>;
}

describe('router', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('[01a S35 b] useHashRoute follows hashchange', () => {
    act(() => root.render(<Show />));
    expect(container.textContent).toBe('/');

    act(() => {
      window.location.hash = '#/menu';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('/menu');

    act(() => {
      window.location.hash = '#/floors';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('/floors');
  });
});
