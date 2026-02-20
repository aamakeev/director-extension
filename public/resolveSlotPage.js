const resolveSlotPage = (slotType, context) => {
  if (slotType === 'EXTENSION_SLOT_MAIN_GAME_FUN') {
    return 'menu';
  }

  if (slotType === 'EXTENSION_SLOT_RIGHT_OVERLAY') {
    return 'overlay';
  }

  if (slotType === 'EXTENSION_SLOT_BACKGROUND') {
    return context?.user?.isModel ? 'background' : null;
  }

  return null;
};

export default resolveSlotPage;
