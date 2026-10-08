import { createContext, useContext } from 'react';

/** App-wide navigation: go(view, {tab}), inspect(url, {live, ai}), openAudit(id), analyze(auditId). */
export const NavContext = createContext(null);
export const useNav = () => useContext(NavContext);
