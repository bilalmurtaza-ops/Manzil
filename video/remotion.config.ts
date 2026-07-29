import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Crisper text/edges than the default 1x when rendering the 4K variant.
Config.setChromiumOpenGlRenderer('angle');
