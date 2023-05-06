import { Event } from '../type';

export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toLocaleIsoString = (date: any) => {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (date.toString() === 'Invalid Date') {
    return 'Invalid Date';
  }

  console.log('original date', date);

  date.setHours(date.getHours() + 9);
  const pad = (num: number) => String(num).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const tzMin = -540;
  const timezone = `${tzMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(tzMin) / 60))}:${pad(Math.abs(tzMin) % 60)}`;
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${timezone}`;
};

export const normDate = (str: string) => {
  if (!str) return '';
  const date = new Date(str);
  return date.toISOString();
};

export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : '',
    title: match ? str.replace(match[0], '') : str,
  };
};
