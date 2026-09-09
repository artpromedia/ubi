import React from 'react';
import { View, Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider, FlagGate } from '@ubi/mobile-ui';
import { FlagsProvider, TID } from '@ubi/mobile-core';

function GatedTile() {
  return (
    <View testID="ai-tile">
      <Text>Ask UBI</Text>
    </View>
  );
}

// A city with no reachable config resolves to DENY_ALL (deny-by-default, launch
// CLAUDE.md #5). Passing cityId=undefined drives FlagsProvider straight to the
// denied state without any network, which is exactly the DENY_ALL surface.
describe('FlagGate under DENY_ALL', () => {
  it('hides the gated tile and shows the honest "not available here" screen', async () => {
    render(
      <ThemeProvider defaultMode="light">
        <FlagsProvider cityId={undefined}>
          <FlagGate flag="ai_assistant" featureName="Ask UBI" onDismiss={() => {}}>
            <GatedTile />
          </FlagGate>
        </FlagsProvider>
      </ThemeProvider>,
    );

    // The flag-off screen appears once the provider settles into "denied".
    await waitFor(() => expect(screen.getByTestId(TID.common.flagOff.screen)).toBeTruthy());
    expect(screen.getByText("Ask UBI isn't available here yet")).toBeTruthy();

    // The gated content is never rendered.
    expect(screen.queryByTestId('ai-tile')).toBeNull();
  });
});
