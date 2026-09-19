# Token-efficient context: one measured conversation

[Watch the 15-second video](https://toolbraid.pages.dev/#token-efficiency) · [Back to the overview](../README.md#token-efficient-context)

Measured on **19 September 2026**, using [one public X conversation](https://x.com/dandumt23/status/2101285299875656175) with seven rendered posts. This compares returned text, not total agent usage or billing.

| Returned representation | Tokens (`o200k_base`) |
| --- | ---: |
| Full integrated-browser DOM snapshot | 5,094 |
| ToolBraid `community_inspect` structured payload | 821 |
| Custom browser extraction of message JSON | 661 |
| ToolBraid projected to that same message JSON | 661 |

ToolBraid's ready-made payload was **83.9% smaller than the full snapshot**. The ordered post IDs, authors, complete message text and canonical links matched. The optimized browser result was smaller than ToolBraid's complete payload, which also includes coverage, page/capture metadata and truncation indicators. Projecting both to the same message schema produced identical bytes.

## What was counted

The frozen text was counted with `tiktoken==0.12.0`, explicitly selecting `o200k_base`. This is not evidence of the active model's tokenizer or the user's billed/account usage. The ToolBraid measurement uses the structured payload delivered by the orchestration, not a serialization of its entire MCP envelope. That envelope contains duplicate `content` and `structuredContent` representations and measures 1,687 tokens when serialized whole.

Counts exclude initialization, tool schemas, navigation, selector discovery, commands, assistant reasoning, replies, images and caching. The optimized browser extraction followed page inspection, so 661 is its final payload size, not its complete workflow cost. Browsers can also return diffs or targeted extracts.

This sample does not establish a universal advantage over optimized browser automation, nor measure task quality or latency. Both sessions were authenticated; only public conversation text was compared. No posts, likes or extension changes were made during the measurement. Re-fetching a live page may produce different results.

## Video description

The 1080p, 15-second motion graphic opens with the ToolBraid logo and “Token-efficient context for your AI.” It introduces the seven-post public conversation, then compares the three returned payload sizes on a shared scale. It explicitly shows that custom browser extraction is smaller still and closes with ToolBraid Companion branding. It has sound effects and no spoken narration; the results and limitations are available in text above. This is an animated presentation of a recorded measurement, not a real-time screen recording.

Video SHA-256: `7a712ff61e8c34a973a3c9d2f1436b2d36ed808a9243b7c5131b7c6bad61a819`.
