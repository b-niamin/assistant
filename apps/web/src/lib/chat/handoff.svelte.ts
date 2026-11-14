/**
 * Pages hand the chat a request (askAgent: sent at once) or a draft (draftForAgent: typed into the box for the
 * owner to finish). The chat page (/chat) takes it on its next mount and starts a new conversation with it.
 */
export const chatHandoff = $state({ ask: '', draft: '' });
