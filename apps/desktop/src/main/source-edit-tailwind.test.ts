import { describe, expect, it } from 'vitest';
import { looksLikeTailwindClassName, mergeTailwindClasses } from './source-edit-tailwind';

describe('Tailwind class merging', () => {
  it('replaces conflicting padding and margin utilities without dropping orthogonal sides', () => {
    expect(mergeTailwindClasses('p-4 text-sm', 'p-6')).toBe('text-sm p-6');
    expect(mergeTailwindClasses('px-4 py-2', 'px-8')).toBe('py-2 px-8');
    expect(mergeTailwindClasses('pt-2 pr-3 pb-4 pl-5', 'pb-8 pl-1')).toBe('pt-2 pr-3 pb-8 pl-1');
    expect(mergeTailwindClasses('m-2 mx-4', '-m-4')).toBe('mx-4 -m-4');
    expect(mergeTailwindClasses('mt-4 mb-2', 'mt-6 my-8')).toBe('mb-2 mt-6 my-8');
  });

  it('distinguishes text size, text color, and text alignment', () => {
    expect(mergeTailwindClasses('text-sm text-slate-900 text-left', 'text-lg')).toBe(
      'text-slate-900 text-left text-lg',
    );
    expect(mergeTailwindClasses('text-sm text-slate-900 text-left', 'text-blue-600')).toBe(
      'text-sm text-left text-blue-600',
    );
    expect(mergeTailwindClasses('text-sm text-slate-900 text-left', 'text-center')).toBe(
      'text-sm text-slate-900 text-center',
    );
    expect(mergeTailwindClasses('text-[14px] text-[#111]', 'text-[18px] text-[#fff]')).toBe(
      'text-[18px] text-[#fff]',
    );
  });

  it('distinguishes font weight vs font family and border width vs color vs style', () => {
    expect(mergeTailwindClasses('font-sans font-medium', 'font-bold')).toBe('font-sans font-bold');
    expect(mergeTailwindClasses('font-sans font-medium', 'font-mono')).toBe(
      'font-medium font-mono',
    );
    expect(
      mergeTailwindClasses('border border-slate-200 border-solid', 'border-2 border-red-500'),
    ).toBe('border-solid border-2 border-red-500');
  });

  it('resolves display, flex, alignment, sizing, background, rounded, gap, opacity, and shadow conflicts', () => {
    expect(
      mergeTailwindClasses(
        'block flex-col items-start justify-start',
        'flex justify-between items-center',
      ),
    ).toBe('flex-col flex justify-between items-center');
    expect(
      mergeTailwindClasses('flex-row flex-nowrap flex-1', 'flex-col flex-wrap flex-none'),
    ).toBe('flex-col flex-wrap flex-none');
    expect(mergeTailwindClasses('hidden', 'grid')).toBe('grid');
    expect(
      mergeTailwindClasses(
        'w-full h-10 bg-white rounded-md gap-2 opacity-50 shadow-sm',
        'w-1/2 h-auto bg-slate-900 rounded-xl gap-4 opacity-100 shadow-lg',
      ),
    ).toBe('w-1/2 h-auto bg-slate-900 rounded-xl gap-4 opacity-100 shadow-lg');
  });

  it('keeps distinct variant prefixes independent and deduplicates identical utilities', () => {
    expect(
      mergeTailwindClasses('bg-white hover:bg-slate-100 md:p-4', 'bg-black hover:bg-blue-500'),
    ).toBe('md:p-4 bg-black hover:bg-blue-500');
    expect(mergeTailwindClasses('flex p-2 flex', '')).toBe('p-2 flex');
  });

  it('detects Tailwind-like class lists accurately', () => {
    expect(looksLikeTailwindClassName('flex items-center px-4 py-2 bg-slate-900')).toBe(true);
    expect(looksLikeTailwindClassName('hero-card primary-surface')).toBe(false);
    expect(looksLikeTailwindClassName('')).toBe(false);
  });
});
