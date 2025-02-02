// v20250130
let backupIntervalRunning = false;
let wasImportSuccessful = false;
let isExportInProgress = false;
let isImportInProgress = false;
let isSnapshotInProgress = false;
const TIME_BACKUP_INTERVAL = 15;
const TIME_BACKUP_FILE_PREFIX = `T-${TIME_BACKUP_INTERVAL}`;

// Move this variable declaration to the top
let awsSdkLoadPromise = null;

// Pre-load AWS SDK as soon as possible
const awsSdkPromise = loadAwsSdk();

(async function checkDOMOrRunBackup() {
	// Start loading AWS SDK immediately
	await awsSdkPromise;
	
	// Use 'interactive' instead of 'complete' to start sooner
	if (document.readyState !== 'loading') {
		await handleDOMReady();
	} else {
		// Use DOMContentLoaded instead of load
		window.addEventListener('DOMContentLoaded', handleDOMReady);
	}
})();

async function handleDOMReady() {
	window.removeEventListener('DOMContentLoaded', handleDOMReady);
	
	// Start the import process immediately if credentials exist
	const bucketName = localStorage.getItem('aws-bucket');
	const awsAccessKey = localStorage.getItem('aws-access-key');
	const awsSecretKey = localStorage.getItem('aws-secret-key');
	
	if (bucketName && awsAccessKey && awsSecretKey) {
		var importSuccessful = await checkAndImportBackup();

		const storedSuffix = localStorage.getItem('last-daily-backup-in-s3');
		const today = new Date();
		const currentDateSuffix = `${today.getFullYear()}${String(
			today.getMonth() + 1
		).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
		const currentTime = new Date().toLocaleString();
		const lastSync = localStorage.getItem('last-cloud-sync');
		var element = document.getElementById('last-sync-msg');

		if (lastSync && importSuccessful) {
			if (element !== null) {
				element.innerText = `Last sync done at ${currentTime}`;
				element = null;
			}
			if (!storedSuffix || currentDateSuffix > storedSuffix) {
				await handleBackupFiles();
			}
			localStorage.setItem('activeTabBackupRunning', 'false');  // Reset flag
			startBackupInterval();
		} else if (!backupIntervalRunning) {
			startBackupInterval();
		}
	} else {
		// No credentials, skip import
		startBackupInterval();
	}
}

// Create a new button
const cloudSyncBtn = document.createElement('button');
cloudSyncBtn.setAttribute('data-element-id', 'cloud-sync-button');
cloudSyncBtn.className =
	'cursor-default group flex items-center justify-center p-1 text-sm font-medium flex-col group focus:outline-0 focus:text-white text-white/70';

const cloudIconSVG = `
<svg class="w-6 h-6 flex-shrink-0" width="24px" height="24px" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M19 9.76c-.12-3.13-2.68-5.64-5.83-5.64-2.59 0-4.77 1.68-5.53 4.01-.19-.03-.39-.04-.57-.04-2.45 0-4.44 1.99-4.44 4.44 0 2.45 1.99 4.44 4.44 4.44h11.93c2.03 0 3.67-1.64 3.67-3.67 0-1.95-1.52-3.55-3.44-3.65zm-5.83-3.64c2.15 0 3.93 1.6 4.21 3.68l.12.88.88.08c1.12.11 1.99 1.05 1.99 2.19 0 1.21-.99 2.2-2.2 2.2H7.07c-1.64 0-2.97-1.33-2.97-2.97 0-1.64 1.33-2.97 2.97-2.97.36 0 .72.07 1.05.2l.8.32.33-.8c.59-1.39 1.95-2.28 3.45-2.28z" fill="currentColor"></path>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 15.33v-5.33M9.67 12.33L12 14.67l2.33-2.34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
`;

const textSpan = document.createElement('span');
textSpan.className =
	'font-normal self-stretch text-center text-xs leading-4 md:leading-none';
textSpan.innerText = 'Backup';

const iconSpan = document.createElement('span');
iconSpan.className =
	'block group-hover:bg-white/30 w-[35px] h-[35px] transition-all rounded-lg flex items-center justify-center group-hover:text-white/90';
iconSpan.innerHTML = cloudIconSVG;

cloudSyncBtn.appendChild(iconSpan);
cloudSyncBtn.appendChild(textSpan);

function insertCloudSyncButton() {
	const teamsButton = document.querySelector(
		'[data-element-id="workspace-tab-teams"]'
	);

	if (teamsButton && teamsButton.parentNode) {
		teamsButton.parentNode.insertBefore(cloudSyncBtn, teamsButton.nextSibling);
		return true;
	}
	return false;
}

const observer = new MutationObserver((mutations) => {
	if (insertCloudSyncButton()) {
		observer.disconnect();
	}
});

observer.observe(document.body, {
	childList: true,
	subtree: true,
});

const maxAttempts = 10;
let attempts = 0;
const interval = setInterval(() => {
	if (insertCloudSyncButton() || attempts >= maxAttempts) {
		clearInterval(interval);
	}
	attempts++;
}, 1000);

// Attach modal to new button
cloudSyncBtn.addEventListener('click', function () {
	openSyncModal();
});

// New Popup
let lastBackupTime = 0;
let backupInterval;

function openSyncModal() {
	var existingModal = document.querySelector(
		'div[data-element-id="sync-modal-dbbackup"]'
	);
	if (existingModal) {
		return;
	}
	var modalPopup = document.createElement('div');
	modalPopup.style.cssText = 'padding-left: 10px; padding-right: 10px; overflow-y: auto;';
	modalPopup.setAttribute('data-element-id', 'sync-modal-dbbackup');
	modalPopup.className =
		'bg-opacity-75 fixed inset-0 bg-gray-800 transition-all flex items-center justify-center z-[60]';
	modalPopup.innerHTML = `
        <div class="inline-block w-full align-bottom bg-white dark:bg-zinc-950 rounded-lg px-4 pb-4 text-left shadow-xl transform transition-all sm:my-8 sm:p-6 sm:align-middle pt-4 overflow-hidden sm:max-w-lg">
            <div class="text-gray-800 dark:text-white text-left text-sm">
                <div class="flex justify-center items-center mb-4">
                    <h3 class="text-center text-xl font-bold">Backup & Sync</h3>
                    <div class="relative group ml-2">
                        <span class="cursor-pointer" id="info-icon" style="color: white">ℹ</span>
                        <div id="tooltip" style="display:none; width: 250px; margin-top: 0.5em;" class="z-1 absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs rounded-md px-2 py-1 opacity-90 transition-opacity duration-300 opacity-0 transition-opacity">
                            Fill form & Save. If you are using Amazon S3 - fill in S3 Bucket Name, AWS Region, AWS Access Key, AWS Secret Key.<br/><br/> Initial backup: You will need to click on "Export" to create your first backup in S3. Thereafter, automatic backups are done to S3 every 1 minute if the browser tab is active.<br/><br/> Restore backup: If S3 already has an existing backup, this extension will automatically pick it and restore the data in this typingmind instance. <br/><br/> Adhoc Backup & Restore:  Use the "Export" and "Import" to perform on-demand backup or restore. Note that this overwrites the main backup. <br/><br/> Snapshot: Creates an instant 'no-touch' backup that will not be overwritten. <br/><br/> Download: You can select the backup data to be download and click on Download button to download it for local storage. <br/><br/> Restore: Select the backup you want to restore and Click on Restore. The typingmind data will be restored to the selected backup data/date.
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div>
		    <div class="mt-6 bg-gray-100 px-3 py-3 rounded-lg border border-gray-200 dark:bg-zinc-800 dark:border-gray-600">
    <div class="flex items-center justify-between mb-2">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-400">Available Backups</label>
        <button id="refresh-backups-btn" class="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50" disabled>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
        </button>
    </div>
    <div class="space-y-2">
        <div class="w-full">
            <select id="backup-files" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700">
                <option value="">Please configure AWS credentials first</option>
            </select>
        </div>
        <div class="flex justify-end space-x-2">
            <button id="download-backup-btn" class="z-1 px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Download
            </button>
            <button id="restore-backup-btn" class="z-1 px-3 py-2 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Restore
            </button>
            <button id="delete-backup-btn" class="z-1 px-3 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Delete
            </button>
        </div>
    </div>
</div>
                        <div class="my-4 bg-gray-100 px-3 py-3 rounded-lg border border-gray-200 dark:bg-zinc-800 dark:border-gray-600">
                            <div class="space-y-4">
                                <div>
                                    <label for="aws-bucket" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Bucket Name</label>
                                    <input id="aws-bucket" name="aws-bucket" type="text" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-region" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Region</label>
                                    <input id="aws-region" name="aws-region" type="text" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-access-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Access Key</label>
                                    <input id="aws-access-key" name="aws-access-key" type="password" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-secret-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Secret Key</label>
                                    <input id="aws-secret-key" name="aws-secret-key" type="password" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-endpoint" class="block text-sm font-medium text-gray-700 dark:text-gray-400">S3 Compatible Storage Endpoint (Optional)</label>
                                    <input id="aws-endpoint" name="aws-endpoint" type="text" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off">
                                </div>
                                <div>
				    <label for="backup-interval" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Backup Interval (sec)</label>
				    <input id="backup-interval" name="backup-interval" type="number" min="30" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
				</div>
                                <div>
                                    <label for="encryption-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Encryption Key</label>
                                    <input id="encryption-key" name="encryption-key" type="password" class="z-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div class="flex justify-between space-x-2">
                                    <button id="save-aws-details-btn" type="button" class="z-1 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                                        Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="flex justify-between space-x-2 mt-4">
                        <button id="export-to-s3-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                            <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM770.87 824.869l-52.2 52.2c-4.7 4.7-1.9 12.8 4.7 13.6l179.4 21c5.1.6 9.5-3.7 8.9-8.9l-21-179.4c-.8-6.6-8.9-9.4-13.6-4.7l-52.4 52.4-256.2-256.2c-3.1-3.1-8.2-3.1-11.3 0l-42.4 42.4c-3.1 3.1-3.1 8.2 0 11.3l256.1 256.3Z" transform="matrix(1 0 0 -1 0 1024)"></path>
                            </svg><span>Export</span>
                        </button>
                        <button id="import-from-s3-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                            <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM653.3 599.4l52.2-52.2c4.7-4.7 1.9-12.8-4.7-13.6l-179.4-21c-5.1-.6-9.5 3.7-8.9 8.9l21 179.4c.8 6.6 8.9 9.4 13.6 4.7l52.4-52.4 256.2 256.2c3.1 3.1 8.2 3.1 11.3 0l42.4-42.4c3.1-3.1 3.1-8.2 0-11.3L653.3 599.4Z" transform="matrix(1 0 0 -1 0 1024)"></path>
                            </svg><span>Import</span>
                        </button>
                        <button id="snapshot-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
				<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
				    <path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/>
				    <path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
				</svg><span>Snapshot</span>
			</button>
        		<button id="close-modal-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
        			<span>Close</span>
    			</button>
    </div>

                    <!-- Status messages -->
                    <div class="text-center mt-4">
                        <span id="last-sync-msg"></span>
                    </div>
                    <div id="action-msg" class="text-center"></div>
                </div>
            </div>
        </div>`;
	document.body.appendChild(modalPopup);
	loadBackupFiles();

	const awsBucketInput = document.getElementById('aws-bucket');
	const awsRegionInput = document.getElementById('aws-region');
	const awsAccessKeyInput = document.getElementById('aws-access-key');
	const awsSecretKeyInput = document.getElementById('aws-secret-key');
	const awsEndpointInput = document.getElementById('aws-endpoint');
	const backupIntervalInput = document.getElementById('backup-interval');
	const closeButton = document.getElementById('close-modal-btn');

	const savedBucket = localStorage.getItem('aws-bucket');
	const savedRegion = localStorage.getItem('aws-region');
	const savedAccessKey = localStorage.getItem('aws-access-key');
	const savedSecretKey = localStorage.getItem('aws-secret-key');
	const savedEndpoint = localStorage.getItem('aws-endpoint');
	const lastSync = localStorage.getItem('last-cloud-sync');
	const savedInterval = localStorage.getItem('backup-interval') || '60';
	const savedEncryptionKey = localStorage.getItem('encryption-key');

	if (savedBucket) awsBucketInput.value = savedBucket;
	if (savedRegion) awsRegionInput.value = savedRegion;
	if (savedAccessKey) awsAccessKeyInput.value = savedAccessKey;
	if (savedSecretKey) awsSecretKeyInput.value = savedSecretKey;
	if (savedEndpoint) awsEndpointInput.value = savedEndpoint;
	if (backupIntervalInput) backupIntervalInput.value = savedInterval;
	if (savedEncryptionKey) document.getElementById('encryption-key').value = savedEncryptionKey;

	//const currentTime = new Date().toLocaleString();
	var element = document.getElementById('last-sync-msg');
	if (lastSync) {
		if (element !== null) {
			element.innerText = `Last sync done at ${lastSync}`;
			element = null;
		}
	}

	// Update updateButtonState to make encryption key optional
	function updateButtonState() {
		const isDisabled =
			!awsBucketInput.value.trim() ||
			!awsRegionInput.value.trim() ||
			!awsAccessKeyInput.value.trim() ||
			!awsSecretKeyInput.value.trim() ||
			!backupIntervalInput.value ||
			backupIntervalInput.value < 15 ||
			(document.getElementById('encryption-key').value.trim() !== '' && 
			 document.getElementById('encryption-key').value.trim().length < 8);
		document.getElementById('export-to-s3-btn').disabled = isDisabled;
		document.getElementById('import-from-s3-btn').disabled = isDisabled;
		document.getElementById('save-aws-details-btn').disabled = isDisabled;
		document.getElementById('snapshot-btn').disabled = isDisabled;
	}

	modalPopup.addEventListener('click', function (event) {
		if (event.target === modalPopup) {
			modalPopup.remove();
		}
	});

	awsBucketInput.addEventListener('input', updateButtonState);
	awsRegionInput.addEventListener('input', updateButtonState);
	awsAccessKeyInput.addEventListener('input', updateButtonState);
	awsSecretKeyInput.addEventListener('input', updateButtonState);
	awsEndpointInput.addEventListener('input', updateButtonState);
	backupIntervalInput.addEventListener('input', updateButtonState);

	updateButtonState();

	const infoIcon = document.getElementById('info-icon');
	const tooltip = document.getElementById('tooltip');

	function showTooltip() {
		tooltip.style.removeProperty('display');
		tooltip.classList.add('opacity-100');
		tooltip.classList.remove('z-1');
		tooltip.classList.add('z-10');
		tooltip.classList.remove('opacity-0');
	}

	function hideTooltip() {
		tooltip.style.display = 'none';
		tooltip.classList.add('opacity-0');
		tooltip.classList.remove('z-10');
		tooltip.classList.add('z-1');
		tooltip.classList.remove('opacity-100');
	}

	infoIcon.addEventListener('click', () => {
		const isVisible = tooltip.classList.contains('opacity-100');
		if (isVisible) {
			hideTooltip();
		} else {
			showTooltip();
		}
	});

	document
		.getElementById('backup-files')
		.addEventListener('change', updateBackupButtons);
	document
		.getElementById('download-backup-btn')
		.addEventListener('click', downloadBackupFile);
	document
		.getElementById('restore-backup-btn')
		.addEventListener('click', restoreBackupFile);
	document
		.getElementById('refresh-backups-btn')
		.addEventListener('click', loadBackupFiles);
	document
		.getElementById('delete-backup-btn')
		.addEventListener('click', deleteBackupFile);

	// Save button click handler
	document
		.getElementById('save-aws-details-btn')
		.addEventListener('click', async function () {
			let extensionURLs = JSON.parse(
				localStorage.getItem('TM_useExtensionURLs') || '[]'
			);
			if (!extensionURLs.some((url) => url.endsWith('s3.js'))) {
				extensionURLs.push(
					'https://itcon-pty-au.github.io/typingmind-cloud-backup/s3.js'
				);
				localStorage.setItem(
					'TM_useExtensionURLs',
					JSON.stringify(extensionURLs)
				);
			}
			const bucketName = awsBucketInput.value.trim();
			const region = awsRegionInput.value.trim();
			const accessKey = awsAccessKeyInput.value.trim();
			const secretKey = awsSecretKeyInput.value.trim();
			const endpoint = awsEndpointInput.value.trim();
			const backupInterval = document.getElementById('backup-interval').value;
			const encryptionKey = document.getElementById('encryption-key').value.trim();  // Add this line

			if (backupInterval < 15) {
				alert('Backup interval must be at least 15 seconds');
				return;
			}

			// Add encryption key validation
			if (encryptionKey !== '') {
				if (encryptionKey.length < 8) {
					alert('Encryption key must be at least 8 characters long');
					return;
				}
				localStorage.setItem('encryption-key', encryptionKey);
			} else {
				localStorage.removeItem('encryption-key');
			}

			localStorage.setItem('aws-region', region);
			localStorage.setItem('aws-endpoint', endpoint);

			try {
				await validateAwsCredentials(bucketName, accessKey, secretKey);
				localStorage.setItem('backup-interval', backupInterval);
				localStorage.setItem('aws-bucket', bucketName);
				localStorage.setItem('aws-access-key', accessKey);
				localStorage.setItem('aws-secret-key', secretKey);
				const actionMsgElement = document.getElementById('action-msg');
				actionMsgElement.textContent = 'AWS details saved!';
				actionMsgElement.style.color = 'white';
				setTimeout(() => {
					actionMsgElement.textContent = '';
				}, 3000);
				clearInterval(backupInterval);
				backupIntervalRunning = false;
				startBackupInterval();
				updateButtonState();
				updateBackupButtons();
				await loadBackupFiles();
				var importSuccessful = await checkAndImportBackup();
				const currentTime = new Date().toLocaleString();
				const lastSync = localStorage.getItem('last-cloud-sync');
				var element = document.getElementById('last-sync-msg');
				if (lastSync && importSuccessful) {
					if (element !== null) {
						element.innerText = `Last sync done at ${currentTime}`;
						element = null;
					}
				}
				startBackupInterval();
			} catch (err) {
				const actionMsgElement = document.getElementById('action-msg');
				actionMsgElement.textContent = `Invalid AWS details: ${err.message}`;
				actionMsgElement.style.color = 'red';
				localStorage.setItem('aws-bucket', '');
				localStorage.setItem('aws-access-key', '');
				localStorage.setItem('aws-secret-key', '');
				clearInterval(backupInterval);
			}
		});

	// Export button click handler
	document
		.getElementById('export-to-s3-btn')
		.addEventListener('click', async function () {
			if (isExportInProgress) return;
			const exportBtn = document.getElementById('export-to-s3-btn');
			exportBtn.disabled = true;
			exportBtn.style.cursor = 'not-allowed';
			exportBtn.textContent = 'Exporting';
			isExportInProgress = true;

			try {
				await backupToS3();
			} finally {
				isExportInProgress = false;
				exportBtn.disabled = false;
				exportBtn.style.cursor = 'pointer';
				exportBtn.innerHTML =
					'<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM770.87 824.869l-52.2 52.2c-4.7 4.7-1.9 12.8 4.7 13.6l179.4 21c5.1.6 9.5-3.7 8.9-8.9l-21-179.4c-.8-6.6-8.9-9.4-13.6-4.7l-52.4 52.4-256.2-256.2c-3.1-3.1-8.2-3.1-11.3 0l-42.4 42.4c-3.1 3.1-3.1 8.2 0 11.3l256.1 256.3Z"></path></svg><span>Export</span>';
			}
		});

	// Import button click handler
	document
		.getElementById('import-from-s3-btn')
		.addEventListener('click', async function () {
			if (isImportInProgress) return;
			const importBtn = document.getElementById('import-from-s3-btn');
			importBtn.disabled = true;
			importBtn.style.cursor = 'not-allowed';
			importBtn.textContent = 'Importing';
			isImportInProgress = true;

			try {
				await importFromS3();
			} finally {
				isImportInProgress = false;
				importBtn.disabled = false;
				importBtn.style.cursor = 'pointer';
				importBtn.innerHTML =
					'<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM653.3 599.4l52.2-52.2c4.7-4.7 1.9-12.8-4.7-13.6l-179.4-21c-5.1-.6-9.5 3.7-8.9 8.9l21 179.4c.8 6.6 8.9 9.4 13.6 4.7l52.4-52.4 256.2 256.2c3.1 3.1 8.2 3.1 11.3 0l42.4-42.4c3.1-3.1 3.1-8.2 0-11.3L653.3 599.4Z"></path></svg><span>Import</span>';
			}
		});

	// Close button click handler
	closeButton.addEventListener('click', function () {
		modalPopup.remove();
	});

	// Snapshot button click handler
	document
		.getElementById('snapshot-btn')
		.addEventListener('click', async function () {
			const snapshotBtn = document.getElementById('snapshot-btn');

			// If button is disabled, return early
			if (snapshotBtn.disabled) return;

			// Disable button and update UI
			snapshotBtn.disabled = true;
			snapshotBtn.style.cursor = 'not-allowed';
			const originalButtonContent = snapshotBtn.innerHTML;
			snapshotBtn.innerHTML = '<span>Snapshot</span>';

			try {
				console.log(`📸 [${new Date().toLocaleString()}] Starting snapshot creation...`);
				const now = new Date();
				const timestamp =
					now.getFullYear() +
					String(now.getMonth() + 1).padStart(2, '0') +
					String(now.getDate()).padStart(2, '0') +
					'T' +
					String(now.getHours()).padStart(2, '0') +
					String(now.getMinutes()).padStart(2, '0') +
					String(now.getSeconds()).padStart(2, '0');

				const bucketName = localStorage.getItem('aws-bucket');
				const data = await exportBackupData();
				const encryptedData = await encryptData(data);  // Ensure data is encrypted

				// Load JSZip
				const jszip = await loadJSZip();
				const zip = new jszip();

				// Add the encrypted data to the zip file
				zip.file(`Snapshot_${timestamp}.json`, encryptedData, {
					compression: 'DEFLATE',
					compressionOptions: {
						level: 9,
					},
					binary: true
				});

				// Generate the zip content
				const compressedContent = await zip.generateAsync({ type: 'blob' });

				const s3 = new AWS.S3();
				const putParams = {
					Bucket: bucketName,
					Key: `Snapshot_${timestamp}.zip`,
					Body: compressedContent,
					ContentType: 'application/zip',
					ServerSideEncryption: 'AES256'
				};

				await s3.putObject(putParams).promise();

				// Update last sync message with snapshot status
				const lastSyncElement = document.getElementById('last-sync-msg');
				const currentTime = new Date().toLocaleString();
				lastSyncElement.textContent = `Snapshot successfully saved to the cloud at ${currentTime}`;

				// Revert back to regular sync status after 3 seconds
				setTimeout(() => {
					const lastSync = localStorage.getItem('last-cloud-sync');
					if (lastSync) {
						lastSyncElement.textContent = `Last sync done at ${lastSync}`;
					}
				}, 3000);

				// Refresh the backup files list after successful snapshot
				await loadBackupFiles();
				console.log(`✅ [${new Date().toLocaleString()}] Snapshot created successfully: Snapshot_${timestamp}.zip`);
			} catch (error) {
				console.error(`❌ [${new Date().toLocaleString()}] Snapshot creation failed:`, error);
				const lastSyncElement = document.getElementById('last-sync-msg');
				lastSyncElement.textContent = `Error creating snapshot: ${error.message}`;

				// Revert back to regular sync status after 3 seconds
				setTimeout(() => {
					const lastSync = localStorage.getItem('last-cloud-sync');
					if (lastSync) {
						lastSyncElement.textContent = `Last sync done at ${lastSync}`;
					}
				}, 3000);
			} finally {
				// Re-enable button and restore original content
				snapshotBtn.disabled = false;
				snapshotBtn.style.cursor = 'pointer';
				snapshotBtn.innerHTML = originalButtonContent;
			}
		});
}

// Update the visibility change handler
document.addEventListener('visibilitychange', async () => {
	console.log(`👁️ [${new Date().toLocaleString()}] Visibility changed: ${document.hidden ? 'hidden' : 'visible'}`);
	
	if (!document.hidden) {
		// Tab became visible
		console.log(`📱 [${new Date().toLocaleString()}] Tab became active`);
		
		// Clear any existing interval first
		localStorage.setItem('activeTabBackupRunning', 'false');
		clearInterval(backupInterval);
		backupIntervalRunning = false;
		
		try {
			// Perform import first
			console.log(`📥 [${new Date().toLocaleString()}] Checking for updates from S3...`);
			const importSuccessful = await checkAndImportBackup();
			
			if (importSuccessful) {
				// Update UI and check daily backup
				const currentTime = new Date().toLocaleString();
				const storedSuffix = localStorage.getItem('last-daily-backup-in-s3');
				const today = new Date();
				const currentDateSuffix = `${today.getFullYear()}${String(
					today.getMonth() + 1
				).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
				
				var element = document.getElementById('last-sync-msg');
				if (element !== null) {
					element.innerText = `Last sync done at ${currentTime}`;
					element = null;
				}
				
				// Check if daily backup is needed
				if (!storedSuffix || currentDateSuffix > storedSuffix) {
					await handleBackupFiles();
				}
				
				// Only start backup interval after successful import
				console.log(`✅ [${new Date().toLocaleString()}] Import successful, starting backup interval`);
				startBackupInterval();
			} else {
				console.log(`⚠️ [${new Date().toLocaleString()}] Import was not successful, not starting backup interval`);
			}
		} catch (error) {
			console.error(`❌ [${new Date().toLocaleString()}] Error during tab activation:`, error);
		}
	} else {
		// Tab became hidden
		console.log(`💤 [${new Date().toLocaleString()}] Tab became inactive`);
		localStorage.setItem('activeTabBackupRunning', 'false');
		clearInterval(backupInterval);
		backupIntervalRunning = false;
	}
});

// Time based backup creates a rolling backup every X minutes. Default is 15 minutes
// Update parameter 'TIME_BACKUP_INTERVAL' in the beginning of the code to customize this
// This is to provide a secondary backup option in case of unintended corruption of the backup file
async function handleTimeBasedBackup() {
	const bucketName = localStorage.getItem('aws-bucket');
	let lastTimeBackup = localStorage.getItem('last-time-based-backup');
	const currentTime = new Date().getTime();

	if (!lastTimeBackup) {
		localStorage.setItem(
			'last-time-based-backup',
			new Date().toLocaleString()
		);
		lastTimeBackup = '0';
	}

	if (
		lastTimeBackup === '0' ||
		currentTime - new Date(lastTimeBackup).getTime() >=
		TIME_BACKUP_INTERVAL * 60 * 1000
	) {
		const s3 = new AWS.S3();

		try {
			const data = await exportBackupData();
			const encryptedData = await encryptData(data);
			const jszip = await loadJSZip();
			const zip = new jszip();
			zip.file(`${TIME_BACKUP_FILE_PREFIX}.json`, encryptedData, {
				compression: 'DEFLATE',
				compressionOptions: {
					level: 9,
				},
				binary: true
			});

			const compressedContent = await zip.generateAsync({ type: 'blob' });
			const uploadParams = {
				Bucket: bucketName,
				Key: `${TIME_BACKUP_FILE_PREFIX}.zip`,
				Body: compressedContent,
				ContentType: 'application/zip',
				ServerSideEncryption: 'AES256'
			};

			await s3.putObject(uploadParams).promise();
			localStorage.setItem(
				'last-time-based-backup',
				new Date(currentTime).toLocaleString()
			);
		} catch (error) {
			console.error('Error creating time-based backup:', error);
		}
	}
}

// Function to check for backup file and import it
async function checkAndImportBackup() {
    const bucketName = localStorage.getItem('aws-bucket');
    const awsRegion = localStorage.getItem('aws-region');
    const awsAccessKey = localStorage.getItem('aws-access-key');
    const awsSecretKey = localStorage.getItem('aws-secret-key');
    const awsEndpoint = localStorage.getItem('aws-endpoint');

    if (bucketName && awsAccessKey && awsSecretKey) {
        if (typeof AWS === 'undefined') {
            await loadAwsSdk();
        }

        const awsConfig = {
            accessKeyId: awsAccessKey,
            secretAccessKey: awsSecretKey,
            region: awsRegion,
        };

        if (awsEndpoint) {
            awsConfig.endpoint = awsEndpoint;
        }

        AWS.config.update(awsConfig);

        const s3 = new AWS.S3();
        const params = {
            Bucket: bucketName,
            Key: 'typingmind-backup.json',
        };

        try {
            // Get object metadata first to check size and last modified
            const headData = await s3.headObject(params).promise();
            const cloudFileSize = headData.ContentLength;
            const cloudLastModified = headData.LastModified;
            const lastSync = localStorage.getItem('last-cloud-sync');

            // Calculate current local data size
            const currentData = await exportBackupData();
            const currentDataStr = JSON.stringify(currentData);
            const localFileSize = new Blob([currentDataStr]).size;
            
            // Calculate size difference percentage
            const sizeDiffPercentage = Math.abs((cloudFileSize - localFileSize) / localFileSize * 100);
            const isWithinSizeTolerance = Math.abs(cloudFileSize - localFileSize) <= 2;

            // Check if we need to prompt user
            const shouldPrompt = localFileSize > 0 && (
                (cloudFileSize < localFileSize && !isWithinSizeTolerance) ||
                (sizeDiffPercentage > 10) ||
                (lastSync && Math.abs(new Date(cloudLastModified) - new Date(lastSync)) / (1000 * 60) > 2)
            );

            if (shouldPrompt) {
                let message = `Warning: Potential data mismatch detected!\n\n`;
                message += `Cloud backup size: ${cloudFileSize} bytes\n`;
                message += `Local data size: ${localFileSize} bytes\n`;
                message += `Size difference: ${sizeDiffPercentage.toFixed(2)}%\n\n`;
                message += `Local last sync: ${lastSync || 'Never'}\n`;
                message += `Cloud last modified: ${cloudLastModified.toLocaleString()}\n\n`;
                
                if (cloudFileSize < localFileSize && !isWithinSizeTolerance) {
                    message += '⚠️ Cloud backup is smaller than local data\n';
                }
                if (sizeDiffPercentage > 10) {
                    message += '⚠️ Significant size difference detected\n';
                }
                if (lastSync) {
                    message += '⚠️ Timestamp mismatch detected\n';
                }
                
                message += '\nDo you want to proceed with importing the cloud backup? This will overwrite your local data.';

                if (!confirm(message)) {
                    return false;
                }
            }

            await importFromS3();
            wasImportSuccessful = true;
            return true;
        } catch (err) {
            if (err.code === 'NoSuchKey') {
                alert("Backup file not found in S3! Run an adhoc 'Export' first.");
            } else {
                localStorage.setItem('aws-bucket', '');
                localStorage.setItem('aws-access-key', '');
                localStorage.setItem('aws-secret-key', '');
                alert('Failed to connect to AWS. Please check your credentials.');
            }
            return false;
        }
    }
    return false;
}

async function loadBackupFiles() {
	const bucketName = localStorage.getItem('aws-bucket');
	const awsAccessKey = localStorage.getItem('aws-access-key');
	const awsSecretKey = localStorage.getItem('aws-secret-key');

	const select = document.getElementById('backup-files');

	// Check if credentials are available
	if (!bucketName || !awsAccessKey || !awsSecretKey) {
		select.innerHTML =
			'<option value="">Please configure AWS credentials first</option>';
		updateBackupButtons();
		return;
	}

	const s3 = new AWS.S3();

	try {
		const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
		select.innerHTML = '';

		if (data.Contents.length === 0) {
			select.innerHTML = '<option value="">No backup files found</option>';
		} else {
			// Sort files by last modified (newest first)
			const files = data.Contents.sort(
				(a, b) => b.LastModified - a.LastModified
			);

			files.forEach((file) => {
				const option = document.createElement('option');
				option.value = file.Key;
				option.textContent = `${file.Key} (${new Date(file.LastModified).toLocaleString()})`;
				select.appendChild(option);
			});
		}

		updateBackupButtons();
	} catch (error) {
		console.error('Error loading backup files:', error);
		select.innerHTML = '<option value="">Error loading backups</option>';
		updateBackupButtons();
	}
}

function updateBackupButtons() {
	const select = document.getElementById('backup-files');
	const downloadBtn = document.getElementById('download-backup-btn');
	const restoreBtn = document.getElementById('restore-backup-btn');
	const deleteBtn = document.getElementById('delete-backup-btn');
	const refreshBtn = document.getElementById('refresh-backups-btn');

	const bucketConfigured =
		localStorage.getItem('aws-bucket') &&
		localStorage.getItem('aws-access-key') &&
		localStorage.getItem('aws-secret-key');

	// Enable/disable refresh button based on credentials
	if (refreshBtn) {
		refreshBtn.disabled = !bucketConfigured;
		refreshBtn.classList.toggle('opacity-50', !bucketConfigured);
	}

	const selectedFile = select.value;
	const isSnapshotFile = selectedFile.startsWith('Snapshot_');

	// Enable download button if credentials exist and file is selected
	if (downloadBtn) {
		downloadBtn.disabled = !bucketConfigured || !selectedFile;
		downloadBtn.classList.toggle(
			'opacity-50',
			!bucketConfigured || !selectedFile
		);
	}

	// Enable restore button if credentials exist and valid file is selected
	if (restoreBtn) {
		restoreBtn.disabled =
			!bucketConfigured ||
			!selectedFile ||
			selectedFile === 'typingmind-backup.json';
		restoreBtn.classList.toggle(
			'opacity-50',
			!bucketConfigured ||
			!selectedFile ||
			selectedFile === 'typingmind-backup.json'
		);
	}

	// Enable delete button only for snapshot files
	if (deleteBtn) {
		deleteBtn.disabled = !bucketConfigured || !selectedFile || !isSnapshotFile;
		deleteBtn.classList.toggle(
			'opacity-50',
			!bucketConfigured || !selectedFile || !isSnapshotFile
		);
	}
}

async function downloadBackupFile() {
	let data = null;
	let blob = null;
	let url = null;
	const bucketName = localStorage.getItem('aws-bucket');
	let s3 = new AWS.S3();
	const selectedFile = document.getElementById('backup-files').value;

	try {
		data = await s3
			.getObject({
				Bucket: bucketName,
				Key: selectedFile,
			})
			.promise();

		blob = new Blob([data.Body], { type: data.ContentType });
		url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = selectedFile;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	} catch (error) {
		console.error('Error downloading file:', error);
	} finally {
		// Clean up variables
		data = null;
		blob = null;
		if (url) {
			window.URL.revokeObjectURL(url);
			url = null;
		}
	}
}

async function restoreBackupFile() {
	const bucketName = localStorage.getItem('aws-bucket');
	const s3 = new AWS.S3();
	const selectedFile = document.getElementById('backup-files').value;

	try {
		const data = await s3
			.getObject({
				Bucket: bucketName,
				Key: selectedFile,
			})
			.promise();

		try {
			const jszip = await loadJSZip();
			const zip = await jszip.loadAsync(data.Body);
			const jsonFile = Object.keys(zip.files)[0];
			const encryptedContent = await zip.file(jsonFile).async('uint8array');
			const importedData = await decryptData(encryptedContent);
			importDataToStorage(importedData);
			const currentTime = new Date().toLocaleString();
			localStorage.setItem('last-cloud-sync', currentTime);
			const element = document.getElementById('last-sync-msg');
			if (element) {
				element.innerText = `Last sync done at ${currentTime}`;
			}
			alert('Backup restored successfully!');
		} catch (error) {
			console.error('Error restoring backup:', error);
			alert('Error restoring backup: ' + (error.message || 'Failed to decrypt backup. Please check your encryption key.'));
		}
	} catch (error) {
		console.error('Error restoring backup:', error);
		alert('Error restoring backup: ' + error.message);
	}
}

// Function to start the backup interval
function startBackupInterval() {
	console.log(`🕒 [${new Date().toLocaleString()}] Starting backup interval...`);
	
	// Clear any existing interval first
	if (backupIntervalRunning) {
		console.log(`🔄 [${new Date().toLocaleString()}] Clearing existing interval`);
		clearInterval(backupInterval);
		backupIntervalRunning = false;
	}
	
	// Reset the active tab flag before checking
	localStorage.setItem('activeTabBackupRunning', 'false');
	
	// Small delay to ensure flag is reset across all tabs
	setTimeout(() => {
		// Set flag for this tab
		localStorage.setItem('activeTabBackupRunning', 'true');
		
		const configuredInterval = parseInt(localStorage.getItem('backup-interval')) || 60;
		const intervalInMilliseconds = Math.max(configuredInterval * 1000, 15000); // Minimum 15 seconds
		
		console.log(`ℹ️ [${new Date().toLocaleString()}] Setting backup interval to ${intervalInMilliseconds/1000} seconds`);
		
		backupIntervalRunning = true;
		
		// Initial backup
		performBackup();
		
		// Start a new interval and store the interval ID
		backupInterval = setInterval(() => {
			console.log(`⏰ [${new Date().toLocaleString()}] Interval triggered`);
			performBackup();
		}, intervalInMilliseconds);
		
		// Add a check to ensure interval is running
		setTimeout(() => {
			if (!backupIntervalRunning) {
				console.log(`🔄 [${new Date().toLocaleString()}] Backup interval stopped, restarting...`);
				startBackupInterval();
			}
		}, intervalInMilliseconds + 1000);
	}, 100); // Small delay to ensure clean state
}

// Separate function to handle the backup process
async function performBackup() {
	// Check if tab is hidden - exit early if it is
	if (document.hidden) {
		console.log(`🛑 [${new Date().toLocaleString()}] Tab is hidden, skipping backup`);
		return;
	}

	// If a backup is already in progress, schedule the next one
	if (isExportInProgress) {
		console.log(`⏳ [${new Date().toLocaleString()}] Previous backup still in progress, skipping this iteration`);
		return;
	}

	if (!wasImportSuccessful) {
		console.log(`⚠️ [${new Date().toLocaleString()}] Import not yet successful, skipping backup`);
		return;
	}

	isExportInProgress = true;
	try {
		await backupToS3();
		console.log(`✅ [${new Date().toLocaleString()}] Backup completed, next backup in ${parseInt(localStorage.getItem('backup-interval')) || 60} seconds`);
	} catch (error) {
		console.error(`❌ [${new Date().toLocaleString()}] Backup failed:`, error);
	} finally {
		isExportInProgress = false;
	}
}

// Function to load AWS SDK asynchronously
async function loadAwsSdk() {
	if (awsSdkLoadPromise) return awsSdkLoadPromise;
	
	awsSdkLoadPromise = new Promise((resolve, reject) => {
		if (typeof AWS !== 'undefined') {
			resolve();
			return;
		}
		
		const script = document.createElement('script');
		script.src = 'https://sdk.amazonaws.com/js/aws-sdk-2.804.0.min.js';
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
	
	return awsSdkLoadPromise;
}

// Function to dynamically load the JSZip library
async function loadJSZip() {
	return new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src =
			'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.5.0/jszip.min.js';
		script.onload = () => {
			resolve(window.JSZip); // Pass JSZip to resolve
		};
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

// Function to import data from S3 to localStorage and IndexedDB
function importDataToStorage(data) {
	Object.keys(data.localStorage).forEach((key) => {
		localStorage.setItem(key, data.localStorage[key]);
	});

	const request = indexedDB.open('keyval-store');
	request.onsuccess = function (event) {
		const db = event.target.result;
		const transaction = db.transaction(['keyval'], 'readwrite');
		const objectStore = transaction.objectStore('keyval');
		const deleteRequest = objectStore.clear();
		deleteRequest.onsuccess = function () {
			data = data.indexedDB;
			Object.keys(data).forEach((key) => {
				objectStore.put(data[key], key);
			});
		};
	};
	// Handle disappearing extension issue
	let extensionURLs = JSON.parse(
		localStorage.getItem('TM_useExtensionURLs') || '[]'
	);
	if (!extensionURLs.some((url) => url.endsWith('s3.js'))) {
		extensionURLs.push(
			'https://itcon-pty-au.github.io/typingmind-cloud-backup/s3.js'
		);
		localStorage.setItem('TM_useExtensionURLs', JSON.stringify(extensionURLs));
	}
}

// Function to export data from localStorage and IndexedDB
function exportBackupData() {
	return new Promise((resolve, reject) => {
		let exportData = null;
		let db = null;
		let transaction = null;
		let store = null;
		exportData = {
			localStorage: { ...localStorage },
			indexedDB: {},
		};
		var request = indexedDB.open('keyval-store', 1);
		request.onsuccess = function (event) {
			db = event.target.result;
			transaction = db.transaction(['keyval'], 'readonly');
			store = transaction.objectStore('keyval');
			store.getAllKeys().onsuccess = function (keyEvent) {
				var keys = keyEvent.target.result;
				store.getAll().onsuccess = function (valueEvent) {
					var values = valueEvent.target.result;
					keys.forEach((key, i) => {
						exportData.indexedDB[key] = values[i];
					});
					resolve(exportData);
				};
			};
		};
		request.onerror = function (error) {
			reject(error);
		};
	});
	// Clean up variables
	exportData = null;
	db = null;
	transaction = null;
	store = null;
}

// Function to handle backup to S3 with chunked multipart upload using Blob
async function backupToS3() {
	console.log(`🔄 [${new Date().toLocaleString()}] Starting export to S3...`);
	let data = null;
	let dataStr = null;
	let blob = null;
	const bucketName = localStorage.getItem('aws-bucket');
	const awsRegion = localStorage.getItem('aws-region');
	const awsAccessKey = localStorage.getItem('aws-access-key');
	const awsSecretKey = localStorage.getItem('aws-secret-key');
	const awsEndpoint = localStorage.getItem('aws-endpoint');

	if (typeof AWS === 'undefined') {
		await loadAwsSdk();
	}

	const awsConfig = {
		accessKeyId: awsAccessKey,
		secretAccessKey: awsSecretKey,
		region: awsRegion,
	};

	if (awsEndpoint) {
		awsConfig.endpoint = awsEndpoint;
	}

	AWS.config.update(awsConfig);

	try {
		//console.log('Starting sync to S3 at ' + new Date().toLocaleString());
		data = await exportBackupData();
		console.log(`📤 [${new Date().toLocaleString()}] Starting backup encryption`);
		
		const encryptedData = await encryptData(data);
		console.log(`📦 [${new Date().toLocaleString()}] After encryption`);
		
		// Create blob directly from encrypted data
		blob = new Blob([encryptedData], { type: 'application/octet-stream' });
		console.log(`💾 [${new Date().toLocaleString()}] Blob created`);
		const dataSize = blob.size;
		localStorage.setItem('backup-size', dataSize.toString());
		const chunkSize = 5 * 1024 * 1024; // 5MB chunks

		let s3 = new AWS.S3();

		if (dataSize > chunkSize) {
			try {
				//console.log('Starting Multipart upload to S3');
				const createMultipartParams = {
					Bucket: bucketName,
					Key: 'typingmind-backup.json',
					ContentType: 'application/json',
					ServerSideEncryption: 'AES256'
				};

				const multipart = await s3
					.createMultipartUpload(createMultipartParams)
					.promise();
				const uploadedParts = [];
				let partNumber = 1;

				for (let start = 0; start < dataSize; start += chunkSize) {
					const end = Math.min(start + chunkSize, dataSize);
					const chunk = blob.slice(start, end);

					// Convert chunk to ArrayBuffer using FileReader
					const arrayBuffer = await new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result);
						reader.onerror = () => reject(reader.error);
						reader.readAsArrayBuffer(chunk);
					});

					const partParams = {
						Body: arrayBuffer,
						Bucket: bucketName,
						Key: 'typingmind-backup.json',
						PartNumber: partNumber,
						UploadId: multipart.UploadId,
					};

					let retryCount = 0;
					const maxRetries = 3;

					while (retryCount < maxRetries) {
						try {
							const uploadResult = await s3.uploadPart(partParams).promise();
							//console.log('Upload result:', uploadResult);
							uploadedParts.push({
								ETag: uploadResult.ETag,
								PartNumber: partNumber,
							});
							//console.log(`Part ${partNumber} uploaded successfully with ETag: ${uploadResult.ETag}`);
							break; // Success, exit retry loop
						} catch (error) {
							console.error(`Error uploading part ${partNumber}:`, error);
							retryCount++;
							if (retryCount === maxRetries) {
								// If all retries fail, abort the multipart upload
								console.log('All retries failed, aborting multipart upload');
								await s3
									.abortMultipartUpload({
										Bucket: bucketName,
										Key: 'typingmind-backup.json',
										UploadId: multipart.UploadId,
									})
									.promise();
								throw error;
							}
							// Wait before retry (exponential backoff)
							const waitTime = Math.pow(2, retryCount) * 1000;
							console.log(
								`Retrying part ${partNumber} in ${waitTime / 1000} seconds...`
							);
							await new Promise((resolve) => setTimeout(resolve, waitTime));
						}
					}

					partNumber++;

					// Update progress
					const progress = Math.round(((start + chunkSize) / dataSize) * 100);
					//console.log(`Upload progress: ${Math.min(progress, 100)}%`);
				}

				const sortedParts = uploadedParts.sort(
					(a, b) => a.PartNumber - b.PartNumber
				);

				// Complete the multipart upload
				const completeParams = {
					Bucket: bucketName,
					Key: 'typingmind-backup.json',
					UploadId: multipart.UploadId,
					MultipartUpload: {
						Parts: sortedParts.map((part) => ({
							ETag: part.ETag,
							PartNumber: part.PartNumber,
						})),
					},
				};

				//console.log('Complete Multipart Upload Request:', JSON.stringify(completeParams, null, 2));

				await s3.completeMultipartUpload(completeParams).promise();
				//console.log('Multipart upload completed successfully');
			} catch (error) {
				console.error('Multipart upload failed:', error);
				// Fall back to regular upload if multipart fails
				//console.log('Falling back to regular upload');
				const putParams = {
					Bucket: bucketName,
					Key: 'typingmind-backup.json',
					Body: dataStr,
					ContentType: 'application/json',
					ServerSideEncryption: 'AES256'
				};
				await s3.putObject(putParams).promise();
			}
		} else {
			//console.log('Starting standard upload to S3');
			const putParams = {
				Bucket: bucketName,
				Key: 'typingmind-backup.json',
				Body: dataStr,
				ContentType: 'application/json',
				ServerSideEncryption: 'AES256'
			};

			await s3.putObject(putParams).promise();
		}

		await handleTimeBasedBackup();
		const currentTime = new Date().toLocaleString();
		localStorage.setItem('last-cloud-sync', currentTime);
		console.log(`✅ [${new Date().toLocaleString()}] Export completed successfully`);
		var element = document.getElementById('last-sync-msg');
		if (element !== null) {
			element.innerText = `Last sync done at ${currentTime}`;
		}
	} catch (error) {
		console.error(`❌ [${new Date().toLocaleString()}] Export failed:`, error);
		var element = document.getElementById('last-sync-msg');
		if (element !== null) {
			element.innerText = `Backup failed: ${error.message}`;
		}
		throw error;
	} finally {
		// Clean up variables
		data = null;
		dataStr = null;
		blob = null;
	}
}

// Function to handle import from S3
async function importFromS3() {
	console.log(`📥 [${new Date().toLocaleString()}] Starting import from S3...`);
	let importedData = null;
	const bucketName = localStorage.getItem('aws-bucket');
	const awsRegion = localStorage.getItem('aws-region');
	const awsAccessKey = localStorage.getItem('aws-access-key');
	const awsSecretKey = localStorage.getItem('aws-secret-key');
	const awsEndpoint = localStorage.getItem('aws-endpoint');

	if (typeof AWS === 'undefined') {
		await loadAwsSdk();
	}

	const awsConfig = {
		accessKeyId: awsAccessKey,
		secretAccessKey: awsSecretKey,
		region: awsRegion,
	};

	if (awsEndpoint) {
		awsConfig.endpoint = awsEndpoint;
	}

	AWS.config.update(awsConfig);

	let s3 = new AWS.S3();
	const params = {
		Bucket: bucketName,
		Key: 'typingmind-backup.json',
	};

	try {
		// Get object metadata first to check size and last modified
		const headData = await s3.headObject(params).promise();
		const cloudFileSize = headData.ContentLength;
		const cloudLastModified = headData.LastModified;
		const lastSync = localStorage.getItem('last-cloud-sync');

		// Calculate current local data size
		const currentData = await exportBackupData();
		const currentDataStr = JSON.stringify(currentData);
		const localFileSize = new Blob([currentDataStr]).size;
		
		// Calculate size difference percentage
		const sizeDiffPercentage = Math.abs((cloudFileSize - localFileSize) / localFileSize * 100);
		
		// Check if size difference is within tolerance (±2 bytes)
		const isWithinSizeTolerance = Math.abs(cloudFileSize - localFileSize) <= 2;
		
		// Log size comparison details
		console.log(`📊 [${new Date().toLocaleString()}] Size comparison:
    Cloud size: ${cloudFileSize} bytes
    Local size: ${localFileSize} bytes
    Difference: ${cloudFileSize - localFileSize} bytes (${sizeDiffPercentage.toFixed(2)}%)
    Within tolerance: ${isWithinSizeTolerance ? 'Yes' : 'No'}`);

		// Check time difference
		const isTimeDifferenceSignificant = () => {
			if (!lastSync) return false;
			
			// Parse lastSync date (format: "1/30/2025, 11:01:18 PM")
			const lastSyncDate = new Date(lastSync);
			const cloudDate = new Date(cloudLastModified);
			
			// Get difference in minutes
			const diffInMinutes = Math.abs(cloudDate - lastSyncDate) / (1000 * 60);
			
			// Return true if difference is more than 2 minutes
			return diffInMinutes > 2;
		};

		// Check if we need to prompt user
		const shouldPrompt = localFileSize > 0 && (
			(cloudFileSize < localFileSize && !isWithinSizeTolerance) || // Cloud backup is smaller (beyond tolerance)
			(sizeDiffPercentage > 10) || // Size varies by more than 10% (beyond tolerance)
			isTimeDifferenceSignificant() // Time difference > 2 minutes
		);

		if (shouldPrompt) {
			let message = `Warning: Potential data mismatch detected!\n\n`;
			message += `Cloud backup size: ${cloudFileSize} bytes\n`;
			message += `Local data size: ${localFileSize} bytes\n`;
			message += `Size difference: ${sizeDiffPercentage.toFixed(2)}%\n\n`;
			message += `Local last sync: ${lastSync || 'Never'}\n`;
			message += `Cloud last modified: ${cloudLastModified.toLocaleString()}\n\n`;
			
			// Add specific warnings based on what triggered the prompt
			if (cloudFileSize < localFileSize && !isWithinSizeTolerance) {
				message += '⚠️ Cloud backup is smaller than local data\n';
			}
			if (sizeDiffPercentage > 10) {
				message += '⚠️ Significant size difference detected\n';
			}
			if (isTimeDifferenceSignificant()) {
				message += '⚠️ Timestamp mismatch detected\n';
			}
			
			message += '\nDo you want to proceed with importing the cloud backup? This will overwrite your local data.';

			if (!confirm(message)) {
				console.log(`ℹ️ [${new Date().toLocaleString()}] Import cancelled by user`);
				return false; // Return false instead of throwing error
			}
		}

		// Proceed with import if confirmed or if no confirmation needed
		const data = await s3.getObject(params).promise();
		const encryptedContent = new Uint8Array(data.Body);
		try {
			importedData = await decryptData(encryptedContent);
		} catch (error) {
			console.error('Failed to decrypt backup:', error);
			throw new Error('Failed to decrypt backup. Please check your encryption key.');
		}
		importDataToStorage(importedData);
		
		const currentTime = new Date().toLocaleString();
		//localStorage.setItem('last-cloud-sync', currentTime);
		var element = document.getElementById('last-sync-msg');
		if (element !== null) {
			element.innerText = `Last sync done at ${currentTime}`;
		}
		console.log(`✅ [${new Date().toLocaleString()}] Import completed successfully`);
		wasImportSuccessful = true;
		return true;
	} catch (error) {
		console.error(`❌ [${new Date().toLocaleString()}] Import failed:`, error);
		return false; // Return false for any error
	}
}

//Delete file from S3
async function deleteBackupFile() {
	const selectedFile = document.getElementById('backup-files').value;

	// Check if it's a snapshot file
	if (!selectedFile.startsWith('Snapshot_')) {
		return;
	}

	// Ask for confirmation
	const isConfirmed = confirm(
		`Are you sure you want to delete ${selectedFile}? This action cannot be undone.`
	);

	if (!isConfirmed) {
		return;
	}

	const bucketName = localStorage.getItem('aws-bucket');
	const s3 = new AWS.S3();

	try {
		await s3
			.deleteObject({
				Bucket: bucketName,
				Key: selectedFile,
			})
			.promise();

		// Refresh the backup files list
		await loadBackupFiles();

		// Show success message
		const actionMsgElement = document.getElementById('action-msg');
		if (actionMsgElement) {
			actionMsgElement.textContent = 'Backup file deleted successfully';
			actionMsgElement.style.color = 'white';
			setTimeout(() => {
				actionMsgElement.textContent = '';
			}, 3000);
		}
	} catch (error) {
		console.error('Error deleting file:', error);
		const actionMsgElement = document.getElementById('action-msg');
		if (actionMsgElement) {
			actionMsgElement.textContent = `Error deleting file: ${error.message}`;
			actionMsgElement.style.color = 'red';
		}
	}
}

// Validate the AWS connection
async function validateAwsCredentials(bucketName, accessKey, secretKey) {
	const awsRegion = localStorage.getItem('aws-region');
	const awsEndpoint = localStorage.getItem('aws-endpoint');

	if (typeof AWS === 'undefined') {
		await loadAwsSdk();
	}

	const awsConfig = {
		accessKeyId: accessKey,
		secretAccessKey: secretKey,
		region: awsRegion,
	};

	if (awsEndpoint) {
		awsConfig.endpoint = awsEndpoint;
	}

	AWS.config.update(awsConfig);

	const s3 = new AWS.S3();
	const params = {
		Bucket: bucketName,
		MaxKeys: 1,
	};

	return new Promise((resolve, reject) => {
		s3.listObjectsV2(params, function (err, data) {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
}

// Function to create a dated backup copy, zip it, and purge old backups
async function handleBackupFiles() {
	console.log(`📅 [${new Date().toLocaleString()}] Starting daily backup process...`);
	let backupFile = null;
	let backupContent = null;
	let zip = null;
	let compressedContent = null;

	const bucketName = localStorage.getItem('aws-bucket');
	const awsRegion = localStorage.getItem('aws-region');
	const awsAccessKey = localStorage.getItem('aws-access-key');
	const awsSecretKey = localStorage.getItem('aws-secret-key');
	const awsEndpoint = localStorage.getItem('aws-endpoint');

	if (typeof AWS === 'undefined') {
		await loadAwsSdk();
	}

	const awsConfig = {
		accessKeyId: awsAccessKey,
		secretAccessKey: awsSecretKey,
		region: awsRegion,
	};

	if (awsEndpoint) {
		awsConfig.endpoint = awsEndpoint;
	}

	AWS.config.update(awsConfig);

	try {
		let s3 = new AWS.S3();
		const params = {
			Bucket: bucketName,
			Prefix: 'typingmind-backup',
		};

		const today = new Date();
		const currentDateSuffix = `${today.getFullYear()}${String(
			today.getMonth() + 1
		).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

		const data = await s3.listObjectsV2(params).promise();
		
		if (data.Contents.length > 0) {
			const todaysBackupFile = data.Contents.find(
				file => file.Key === `typingmind-backup-${currentDateSuffix}.json` || 
						file.Key === `typingmind-backup-${currentDateSuffix}.zip`
			);
			
			// If no backup exists for today, create one
			if (!todaysBackupFile) {
				const getObjectParams = {
					Bucket: bucketName,
					Key: 'typingmind-backup.json',
				};
				backupFile = await s3.getObject(getObjectParams).promise();
				
				// Decrypt if it's encrypted, then re-encrypt with current key
				const decryptedData = await decryptData(new Uint8Array(backupFile.Body));
				backupContent = await encryptData(decryptedData);
				
				const jszip = await loadJSZip();
				zip = new jszip();
				zip.file(`typingmind-backup-${currentDateSuffix}.json`, backupContent, {
					compression: 'DEFLATE',
						compressionOptions: {
							level: 9,
						},
						binary: true
				});

				compressedContent = await zip.generateAsync({ type: 'blob' });

				const zipKey = `typingmind-backup-${currentDateSuffix}.zip`;
				const uploadParams = {
					Bucket: bucketName,
					Key: zipKey,
					Body: compressedContent,
					ContentType: 'application/zip',
					ServerSideEncryption: 'AES256'
				};
				await s3.putObject(uploadParams).promise();
				console.log(`✅ [${new Date().toLocaleString()}] Daily backup created: ${zipKey}`);
				
				// Update localStorage after successful backup creation
				localStorage.setItem('last-daily-backup-in-s3', currentDateSuffix);
			} else {console.log(`📅 [${new Date().toLocaleString()}] Daily backup file already exists for today`);}

			// Purge backups older than 30 days
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(today.getDate() - 30);
			for (const file of data.Contents) {
				if (file.Key.endsWith('.zip') && file.Key !== 'typingmind-backup.json') {
					const fileDate = new Date(file.LastModified);
					if (fileDate < thirtyDaysAgo) {
						const deleteParams = {
							Bucket: bucketName,
							Key: file.Key,
						};
						await s3.deleteObject(deleteParams).promise();
						console.log('🗑️ Purged old backup:', file.Key);
					}
				}
			}
		}
	} catch (error) {
		console.error(`❌ [${new Date().toLocaleString()}] Daily backup process failed:`, error);
	} finally {
		// Clean up variables
		backupFile = null;
		backupContent = null;
		zip = null;
		compressedContent = null;
	}
}

// Function to derive encryption key from password
async function deriveKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    
    const salt = enc.encode("typingmind-backup-salt");
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Function to encrypt data
async function encryptData(data) {
    const encryptionKey = localStorage.getItem('encryption-key');
    console.log(`🔐 [${new Date().toLocaleString()}] Encryption attempt:`, {
        hasKey: !!encryptionKey
    });

    if (!encryptionKey) {
        console.log(`⚠️ [${new Date().toLocaleString()}] No encryption key found, returning unencrypted data`);
        // Convert data to proper format if unencrypted
        const jsonStr = JSON.stringify(data);
        return new TextEncoder().encode(jsonStr);
    }

    try {
        const key = await deriveKey(encryptionKey);
        const enc = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedData = enc.encode(JSON.stringify(data));
        
        console.log(`📝 [${new Date().toLocaleString()}] Data prepared for encryption:`);

        const encryptedContent = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            encodedData
        );

        const marker = new TextEncoder().encode('ENCRYPTED:');
        const combinedData = new Uint8Array(marker.length + iv.length + encryptedContent.byteLength);
        combinedData.set(marker);
        combinedData.set(iv, marker.length);
        combinedData.set(new Uint8Array(encryptedContent), marker.length + iv.length);
        
        console.log(`✅ [${new Date().toLocaleString()}] Encryption successful`);
        
        return combinedData;
    } catch (error) {
        console.error(`❌ [${new Date().toLocaleString()}] Encryption failed:`, error);
        throw error;
    }
}

// Function to decrypt data
async function decryptData(data) {
    console.log(`🔍 [${new Date().toLocaleString()}] Decryption attempt:`);

    // Check if data is encrypted by looking for the marker
    const marker = 'ENCRYPTED:';
    const dataString = new TextDecoder().decode(data.slice(0, marker.length));
    
    console.log(`🏷️ [${new Date().toLocaleString()}] Checking encryption marker:`, {
        expectedMarker: marker,
        foundMarker: dataString,
        isEncrypted: dataString === marker
    });
    
    if (dataString !== marker) {
        console.log(`ℹ️ [${new Date().toLocaleString()}] Data is not encrypted, returning as-is`);
        return JSON.parse(new TextDecoder().decode(data));
    }

    const encryptionKey = localStorage.getItem('encryption-key');
    if (!encryptionKey) {
        console.error(`❌ [${new Date().toLocaleString()}] Encrypted data found but no key provided`);
        throw new Error('Encrypted backup found but no encryption key provided');
    }

    try {
        const key = await deriveKey(encryptionKey);
        const iv = data.slice(marker.length, marker.length + 12);
        const content = data.slice(marker.length + 12);

        console.log(`🔓 [${new Date().toLocaleString()}] Attempting decryption`);

        const decryptedContent = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            content
        );

        const dec = new TextDecoder();
        const decryptedString = dec.decode(decryptedContent);
        const parsedData = JSON.parse(decryptedString);

        console.log(`✅ [${new Date().toLocaleString()}] Decryption successful`);

        return parsedData;
    } catch (error) {
        console.error(`❌ [${new Date().toLocaleString()}] Decryption failed:`, error);
        throw new Error('Failed to decrypt backup. Please check your encryption key.');
    }
}
