const puppeteer = require("puppeteer");
const fs = require('fs');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const axios = require('axios');
const path = require('path');

const createFolderIfNotExists = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

const downloadAsset = async (url, assetPath) => {
    const writer = fs.createWriteStream(assetPath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

// Function to extract the relative folder and filename from a URL
const getRelativePathFromUrl = (url, baseFolder) => {
    const parsedUrl = new URL(url);
    const relativePath = path.join(baseFolder, parsedUrl.hostname, parsedUrl.pathname);
    return {
        folder: path.dirname(relativePath),
        fileName: path.basename(parsedUrl.pathname),
    };
};

const main = async () => {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Please provide a URL as an argument.');
        process.exit(1);
    }

    const url = args[0];
    try {
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        const html = await page.content();

        // Extract CSS links
        const cssLinks = await page.evaluate(() => {
            const linkTags = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
            return linkTags.map(tag => tag.href);
        });

        // Extract JavaScript links
        const jsLinks = await page.evaluate(() => {
            const scriptTags = Array.from(document.querySelectorAll('script[src]'));
            return scriptTags.map(tag => tag.src);
        });

        // Extract video URLs
        const videoLinks = await page.evaluate(() => {
            const videoTags = Array.from(document.querySelectorAll('video source'));
            return videoTags.map(tag => tag.src);
        });

        // Extract iframe video embeds (YouTube, Vimeo, etc.)
        const iframeVideos = await page.evaluate(() => {
            const iframeTags = Array.from(document.querySelectorAll('iframe[src]'));
            return iframeTags.map(tag => tag.src);
        });

        // Extract links
        const extractLinks = await page.evaluate(() => {
            const linkTags = Array.from(document.querySelectorAll('a'));
            return linkTags.map(tag => tag.href);
        });

        const extractImages = await page.evaluate(() => {
            const imageTags = Array.from(document.querySelectorAll('img'));
            return imageTags.map(tag => tag.src);
        });

        const absoluteLinks = extractLinks.map(link => {
            try {
                return new URL(link, url).href;
            } catch (error) {
                console.warn(`Invalid URL: ${link}`);
                return link;
            }
        });

        const sortLinks = [...new Set(absoluteLinks)].sort();

        // Create the main 'website' folder
        createFolderIfNotExists('website');

        // Write the main HTML to a file
        await writeFile('website/page.html', html);

        // Create 'css', 'js', 'videos', and 'images' folders under 'website'
        createFolderIfNotExists('website/css');
        createFolderIfNotExists('website/js');
        createFolderIfNotExists('website/videos');
        createFolderIfNotExists('website/images');

        // Download and save CSS files
        for (let cssUrl of cssLinks) {
            const { folder, fileName } = getRelativePathFromUrl(cssUrl, 'website/css');
            createFolderIfNotExists(folder);
            const cssContent = await page.evaluate(url => {
                return fetch(url).then(res => res.text());
            }, cssUrl);

            await writeFile(path.join(folder, fileName), cssContent);
        }

        // Download and save JS files
        for (let jsUrl of jsLinks) {
            const { folder, fileName } = getRelativePathFromUrl(jsUrl, 'website/js');
            createFolderIfNotExists(folder);
            const jsContent = await page.evaluate(url => {
                return fetch(url).then(res => res.text());
            }, jsUrl);

            await writeFile(path.join(folder, fileName), jsContent);
        }

        // Download and save images
        for (let imageUrl of extractImages) {
            const { folder, fileName } = getRelativePathFromUrl(imageUrl, 'website/images');
            createFolderIfNotExists(folder);
            try {
                await downloadAsset(imageUrl, path.join(folder, fileName));
                console.log(`Downloaded image: ${fileName}`);
            } catch (error) {
                console.error(`Failed to download image: ${imageUrl}`, error);
            }
        }

        // Download and save videos
        for (let videoUrl of videoLinks) {
            const { folder, fileName } = getRelativePathFromUrl(videoUrl, 'website/videos');
            createFolderIfNotExists(folder);
            try {
                await downloadAsset(videoUrl, path.join(folder, fileName));
                console.log(`Downloaded video: ${fileName}`);
            } catch (error) {
                console.error(`Failed to download video: ${videoUrl}`, error);
            }
        }

        // Write links to file
        await writeFile('website/links.txt', sortLinks.join('\n'));

        // Write iframe-based videos to a separate file
        await writeFile('website/iframe_videos.txt', `Iframe-based videos (YouTube, Vimeo, etc.):\n${iframeVideos.join('\n')}`);

        await browser.close();
    } catch (error) {
        console.error('Error during scraping:', error);
    }
};

main();
