export default function resolveSlotPage(slotType, context) {
  var user = context && context.user;
  var isGuest = Boolean(user && user.isGuest);
  var isModel = Boolean(
    user && !user.isGuest && (user.isModel || (context.model && context.model.id === user.id))
  );

  switch (slotType) {
    case 'EXTENSION_SLOT_MAIN_GAME_FUN':
      return 'mainGameFun';
    case 'EXTENSION_SLOT_RIGHT_OVERLAY':
      if (isModel) return null;
      return 'rightOverlay';
    case 'EXTENSION_SLOT_BACKGROUND':
      if (isGuest) return null;
      if (isModel) return 'backgroundModel';
      return 'backgroundViewer';
    default:
      return null;
  }
}
