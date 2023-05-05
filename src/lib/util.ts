export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : "",
    title: match ? str.replace(match[0], "") : str,
  };
};
