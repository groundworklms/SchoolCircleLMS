import React from "react";

export const I: Record<string, React.ReactNode>;

export function RailButton(props: {
  icon?: React.ReactNode;
  label: string;
  on?: boolean;
  onClick: () => void;
  badge?: number | string | null;
  sub?: boolean;
}): React.JSX.Element;

export function UserMenu(props: {
  name: string;
  role: string;
  initials: string;
  inst?: boolean;
  items: Array<'divider' | {
    label: string;
    hint?: string;
    danger?: boolean;
    onClick: () => void;
  }>;
}): React.JSX.Element;
