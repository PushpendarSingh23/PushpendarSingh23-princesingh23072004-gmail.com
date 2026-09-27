import React from 'react';

// Renders an interactive element ONLY if the permission effect is 'allow'.
// Carries data-permission and data-state="unlocked". If denied, renders NOTHING (never disabled).
export function Action({
  permission,
  permissions,
  children,
  component: Component = 'button',
  ...props
}) {
  const perm = permissions?.[permission];
  const isAllowed = typeof perm === 'boolean' ? perm : perm?.effect === 'allow';

  if (!isAllowed) {
    return null;
  }

  return (
    <Component
      data-permission={permission}
      data-state="unlocked"
      {...props}
    >
      {children}
    </Component>
  );
}
