import { truncateToWidth, type Component } from '@moonshot-ai/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';

export type SwarmModeMarkerState = 'active' | 'inactive' | 'ended';

export class SwarmModeMarkerComponent implements Component {
  constructor(private readonly state: SwarmModeMarkerState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const token = swarmMarkerToken(this.state);
    const badge = currentTheme.boldFg('swarm', '[swarm]');
    const marker = currentTheme.boldFg(token, STATUS_BULLET);
    const label = currentTheme.boldFg(token, swarmMarkerLabel(this.state));
    return ['', truncateToWidth(`${marker}${badge} ${label}`, safeWidth, '…')];
  }
}

function swarmMarkerToken(state: SwarmModeMarkerState): ColorToken {
  switch (state) {
    case 'active':
      return 'swarm';
    case 'inactive':
      return 'textDim';
    case 'ended':
      return 'warning';
  }
}

function swarmMarkerLabel(state: SwarmModeMarkerState): string {
  switch (state) {
    case 'active':
      return 'Swarm activated';
    case 'inactive':
      return 'Swarm deactivated';
    case 'ended':
      return 'Swarm ended';
  }
}
