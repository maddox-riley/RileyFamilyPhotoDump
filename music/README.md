# 🎵 Reveal Music

Place your `.mp4` audio files in this folder.

After adding files, open `music.js` and add each filename to the `MUSIC_FILES` array:

```js
const MUSIC_FILES = [
  'your-song.mp4',
  'another-song.mp4',
];
```

The app will randomly pick one song per weekly reveal and play it on loop throughout all the cards.
The same song is used every time you replay that week's reveal.
