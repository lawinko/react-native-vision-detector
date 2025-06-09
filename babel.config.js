module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Module resolver for clean imports
            ['module-resolver', {
                root: ['./'],
                extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.tflite'],
                alias: {
                    '@': './src',
                    '@models': './models',
                    '@assets': './assets',
                }
            }],
            // Reanimated plugin (must be listed last)
            'react-native-reanimated/plugin',
            // Worklets-core plugin for better performance
            'react-native-worklets-core/plugin',
        ],
    };
};
