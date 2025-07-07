/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Newline, Text, useInput } from 'ink';
import { Colors } from '../colors.js';

interface AgentPrivacyNoticeProps {
  onExit: () => void;
}

export const AgentPrivacyNotice = ({ onExit }: AgentPrivacyNoticeProps) => {
  useInput((input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        Agent API Key Notice
      </Text>
      <Newline />
      <Text>
        By using the Agent API<Text color={Colors.AccentBlue}>[1]</Text>,
        Google AI Studio
        <Text color={Colors.AccentRed}>[2]</Text>, and the other Google
        developer services that reference these terms (collectively, the
        &quot;APIs&quot; or &quot;Services&quot;), you are agreeing to Google
        APIs Terms of Service (the &quot;API Terms&quot;)
        <Text color={Colors.AccentGreen}>[3]</Text>, and the Agent API
        Additional Terms of Service (the &quot;Additional Terms&quot;)
        <Text color={Colors.AccentPurple}>[4]</Text>.
      </Text>
      <Newline />
      <Text>
        <Text color={Colors.AccentBlue}>[1]</Text>{' '}
        https://ai.google.dev/docs/agent_api_overview
      </Text>
      <Text>
        <Text color={Colors.AccentRed}>[2]</Text> https://aistudio.google.com/
      </Text>
      <Text>
        <Text color={Colors.AccentGreen}>[3]</Text>{' '}
        https://developers.google.com/terms
      </Text>
      <Text>
        <Text color={Colors.AccentPurple}>[4]</Text>{' '}
        https://ai.google.dev/agent-api/terms
      </Text>
      <Newline />
      <Text color={Colors.Gray}>Press Esc to exit.</Text>
    </Box>
  );
};
