import { zhCN } from "./zh-CN";

type Primitive = string | number | boolean | null | undefined;
interface TranslationTree {
  [key: string]: Primitive | TranslationTree;
}

const resources = {
  "zh-CN": zhCN,
} as const;

type Locale = keyof typeof resources;

let activeLocale: Locale = "zh-CN";

function lookup(tree: TranslationTree, key: string): Primitive {
  const value = key.split(".").reduce<Primitive | TranslationTree>((current, part) => {
    if (current && typeof current === "object" && part in current) return current[part];
    return undefined;
  }, tree);
  return value && typeof value === "object" ? undefined : value;
}

export function setLocale(locale: Locale) {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(key: string, vars?: Record<string, Primitive>): string {
  const value = lookup(resources[activeLocale] as TranslationTree, key);
  const template = typeof value === "string" ? value : key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
