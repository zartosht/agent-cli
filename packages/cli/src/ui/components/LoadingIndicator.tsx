/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThoughtSummary } from '@zartosht/agent-cli-core';
import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { AgentRespondingSpinner } from './AgentRespondingSpinner.js';

interface LoadingIndicatorProps {
  currentLoadingPhrase?: string;
  elapsedTime: number;
  rightContent?: React.ReactNode;
  thought?: ThoughtSummary | null;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  currentLoadingPhrase,
  elapsedTime,
  rightContent,
  thought,
}) => {
  const streamingState = useStreamingContext();

  if (streamingState === StreamingState.Idle) {
    return null;
  }

  const primaryText = thought?.subject || currentLoadingPhrase;

  return (
    <Box marginTop={1} paddingLeft={0} flexDirection="column">
      {/* Main loading line */}
      <Box>
        <Box marginRight={1}>
          <AgentRespondingSpinner
            nonRespondingDisplay={
              streamingState === StreamingState.WaitingForConfirmation
                ? '⠏'
                : ''
            }
          />
        </Box>
        {primaryText && <Text color={Colors.AccentPurple}>{primaryText}</Text>}
        <Text color={Colors.Gray}>
          {streamingState === StreamingState.WaitingForConfirmation
            ? ''
            : ` (esc to cancel, ${elapsedTime}s)`}
        </Text>
        <Box flexGrow={1}>{/* Spacer */}</Box>
        {rightContent && <Box>{rightContent}</Box>}
      </Box>
    </Box>
  );
};
