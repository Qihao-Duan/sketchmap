// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { learnPictureSize, pictureSize } from './pictureSize';

/** Stands in for the browser's Image, which never loads anything in jsdom. */
class FakeImage {
  static made: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  naturalWidth = 0;
  naturalHeight = 0;
  constructor() {
    FakeImage.made.push(this);
  }
  loaded(w: number, h: number) {
    this.naturalWidth = w;
    this.naturalHeight = h;
    this.onload?.();
  }
}
// The sizes are remembered for the whole page, so every test uses a picture of its own.
const key = (name: string) => `img/abcdefghijklmnopqrstu/${name}.png`;

beforeEach(() => {
  FakeImage.made = [];
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

describe('a stored picture’s own size', () => {
  it('is unknown until the browser has loaded the picture, and its pixel size after that', () => {
    expect(pictureSize(key('one'))).toBeNull();
    learnPictureSize(key('one'));
    expect(FakeImage.made.map((i) => i.src)).toEqual([`/${key('one')}`]);
    expect(pictureSize(key('one'))).toBeNull();
    FakeImage.made[0].loaded(1200, 800);
    expect(pictureSize(key('one'))).toEqual({ w: 1200, h: 800 });
  });

  it('loads each picture once, however often it is asked for', () => {
    learnPictureSize(key('two'));
    learnPictureSize(key('two'));
    FakeImage.made[0].loaded(640, 480);
    learnPictureSize(key('two'));
    expect(FakeImage.made).toHaveLength(1);
  });

  it('a picture that could not be loaded stays unknown, and is tried again the next time', () => {
    learnPictureSize(key('three'));
    FakeImage.made[0].onerror?.();
    expect(pictureSize(key('three'))).toBeNull();
    learnPictureSize(key('three'));
    expect(FakeImage.made).toHaveLength(2);
    FakeImage.made[1].loaded(300, 200);
    expect(pictureSize(key('three'))).toEqual({ w: 300, h: 200 });
  });

  it('a picture the browser gives no size for stays unknown', () => {
    learnPictureSize(key('four'));
    FakeImage.made[0].loaded(0, 0);
    expect(pictureSize(key('four'))).toBeNull();
    learnPictureSize(key('five'));
    FakeImage.made[1].loaded(0, 100);
    expect(pictureSize(key('five'))).toBeNull();
    learnPictureSize(key('six'));
    FakeImage.made[2].loaded(100, 0);
    expect(pictureSize(key('six'))).toBeNull();
  });
});
