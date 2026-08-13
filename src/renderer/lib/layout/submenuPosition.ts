export type SubmenuSide = 'left' | 'right';

export type RectLike = Pick<DOMRect, 'top' | 'left' | 'right' | 'width' | 'height'>;

/**
 * Places a submenu beside its parent, preferring the side with room for it and
 * clamping into the viewport, so a menu opened near an edge flips instead of
 * running off the surface.
 */
export function positionSubmenu(
  parent: RectLike,
  submenu: Pick<RectLike, 'width' | 'height'>,
  viewport: {width: number; height: number},
  gap = 4,
  inset = 8,
) {
  const availableLeft = parent.left - gap - inset;
  const availableRight = viewport.width - parent.right - gap - inset;
  const side: SubmenuSide = availableLeft >= submenu.width || availableLeft >= availableRight ? 'left' : 'right';
  const idealLeft = side === 'left' ? parent.left - gap - submenu.width : parent.right + gap;
  const maximumLeft = Math.max(inset, viewport.width - submenu.width - inset);
  const maximumTop = Math.max(inset, viewport.height - submenu.height - inset);

  return {
    side,
    left: Math.max(inset, Math.min(maximumLeft, idealLeft)),
    top: Math.max(inset, Math.min(maximumTop, parent.top)),
  };
}
