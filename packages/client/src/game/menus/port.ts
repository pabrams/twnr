import { Menu } from '@twnr/shared';
import { registerMenu } from './types.js';

// Port menu — class 1-8 trade location. The trading loop is driven
// asynchronously by the dock handler's runTradeRoutine, which uses
// askNumber/askConfirm sub-prompts throughout — so renderPrompt is never
// reached during normal flow (pendingResolver suppresses framework
// auto-render). No menu_command rows; no key dispatch at the menu level.
//
// The pre-dock T/S/Q UI is handled inline by the sector-menu 'port_menu'
// routine — that code path no longer touches this menu name.
registerMenu(Menu.Port, {});
