/* @flow */

import _ from 'lodash';
import { $ } from '../vendor';
import { Module } from '../core/module';
import * as Modules from '../core/modules';
import {
	Alert,
	CreateElement,
	Thing,
	batch,
	click,
	downcast,
	isCurrentSubreddit,
	isPageType,
	loggedInUser,
	string,
	watchForElements,
} from '../utils';
import { Storage, openNewTabs, i18n } from '../environment';
import * as CommandLine from './commandLine';
import * as Dashboard from './dashboard';
import * as KeyboardNav from './keyboardNav';
import * as NightMode from './nightMode';
import * as Notifications from './notifications';
import * as SelectedEntry from './selectedEntry';
import * as SettingsNavigation from './settingsNavigation';

export const module: Module<*> = new Module('userTagger');

module.moduleName = 'userTaggerName';
module.category = 'usersCategory';
module.description = `
	Adds a great deal of customization around users - tagging them, ignoring them, and more. You can manage tagged users on <a href="/r/Dashboard/#userTaggerContents">Manage User Tags</a>.
	<p><b>Ignoring users:</b> users will <i>not</i> be ignored in modmail, moderation queue or your inbox.</p>
`;
module.options = {
	showTaggingIcon: {
		title: 'userTaggerShowTaggingIconTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerShowTaggingIconDesc',
	},
	/*
	defaultMark: {
		type: 'text',
		value: '_',
		description: 'clickable mark for users with no tag'
	},
	*/
	hardIgnore: {
		title: 'userTaggerHardIgnoreTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerHardIgnoreDesc',
	},
	showIgnored: {
		title: 'userTaggerShowIgnoredTitle',
		dependsOn: options => !options.hardIgnore.value,
		type: 'boolean',
		value: true,
		description: 'userTaggerShowIgnoredDesc',
	},
	storeSourceLink: {
		title: 'userTaggerStoreSourceLinkTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerStoreSourceLinkDesc',
		advanced: true,
	},
	useCommentsLinkAsSource: {
		title: 'userTaggerUseCommentsLinkAsSourceTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerUseCommentsLinkAsSourceDesc',
		advanced: true,
	},
	trackVoteWeight: {
		title: 'userTaggerTrackVoteWeightTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerTrackVoteWeightDesc',
		advanced: true,
	},
	vwNumber: {
		title: 'userTaggerVwNumberTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerVWNumberDesc',
		advanced: true,
		dependsOn: options => options.trackVoteWeight.value,
	},
	vwTooltip: {
		title: 'userTaggerVwTooltipTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerVWTooltipDesc',
		advanced: true,
		dependsOn: options => options.trackVoteWeight.value,
	},
};

export const usernameRE = /(?:u|user)\/([\w\-]+)/;

export const tagStorage = Storage.wrapPrefix('tag.', () => (({}: any): {|
	tag?: string,
	link?: string,
	color?: string,
	ignore?: boolean,
	votes?: number,
|}), user => user.toLowerCase());

module.beforeLoad = () => {
	watchForElements(['siteTable', 'newComments'], usernameSelector, applyTagToAuthor);
};

module.go = () => {
	// If we're on the dashboard, add a tab to it...
	if (isCurrentSubreddit('dashboard')) {
		// add tab to dashboard
		const $tabPage = Dashboard.addTab('userTaggerContents', i18n('userTaggerMyUserTags'), module.moduleID);
		// populate the contents of the tab
		const $showDiv = $(string.html`<div class="show">${i18n('userTaggerShow')} </div>`);
		const $tagFilter = $(string.html`<select id="tagFilter"><option>${i18n('userTaggerTaggedUsers')}</option><option>${i18n('userTaggerAllUsers')}</option></select>`);
		$($showDiv).append($tagFilter);
		$tabPage.append($showDiv);
		$('#tagFilter').change(() => drawUserTagTable());

		const tagsPerPage = parseInt(Dashboard.module.options.tagsPerPage.value, 10);
		if (tagsPerPage) {
			const controlWrapper = document.createElement('div');
			controlWrapper.id = 'tagPageControls';
			$(controlWrapper).data({
				page: 1,
				pageCount: 1,
			});

			const leftButton = document.createElement('a');
			leftButton.className = 'res-step noKeyNav';
			leftButton.addEventListener('click', () => {
				const { page, pageCount } = $(controlWrapper).data();
				if (page === 1) {
					$(controlWrapper).data('page', pageCount);
				} else {
					$(controlWrapper).data('page', page - 1);
				}
				drawUserTagTable();
			});
			$(controlWrapper).append(string.escape`${i18n('userTaggerPage')} `);
			controlWrapper.appendChild(leftButton);

			const posLabel = document.createElement('span');
			posLabel.className = 'res-step-progress';
			posLabel.textContent = '1 of 2';
			controlWrapper.appendChild(posLabel);

			const rightButton = document.createElement('a');
			rightButton.className = 'res-step res-step-reverse noKeyNav';
			rightButton.addEventListener('click', () => {
				const { page, pageCount } = $(controlWrapper).data();
				if (page === pageCount) {
					$(controlWrapper).data('page', 1);
				} else {
					$(controlWrapper).data('page', page + 1);
				}
				drawUserTagTable();
			});
			controlWrapper.appendChild(rightButton);

			$tabPage.append(controlWrapper);
		}
		const $thisTable = $(string.html`
			<table id="userTaggerTable">
				<thead>
					<tr>
						<th sort="username" class="active">${i18n('userTaggerUsername')}<span class="sortAsc"></span></th>
						<th sort="tag">${i18n('userTaggerTag')}</th>
						<th sort="ignore">${i18n('userTaggerIgnored')}</th>
						<th sort="color">${i18n('userTaggerColor')}</th>
						<th sort="votes">${i18n('userTaggerVoteWeight')}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);

		$tabPage.append($thisTable);
		$('#userTaggerTable thead th').click(function(e) {
			e.preventDefault();
			const $this = $(this);

			if ($this.hasClass('delete')) {
				return false;
			}
			if ($this.hasClass('active')) {
				$this.toggleClass('descending');
			}
			$this.addClass('active');
			$this.siblings().removeClass('active').find('SPAN').remove();
			$this.find('.sortAsc, .sortDesc').remove();
			$this.append($(e.target).hasClass('descending') ?
				'<span class="sortDesc" />' :
				'<span class="sortAsc" />');
			drawUserTagTable($(e.target).attr('sort'), $(e.target).hasClass('descending'));
		});
		drawUserTagTable();
	}

	if (module.options.trackVoteWeight.value && loggedInUser()) {
		attachVoteHandler();
	}

	addTagger();

	registerCommandLine();
};

export const usernameSelector = '.contents .author, .noncollapsed a.author, p.tagline a.author, #friend-table span.user a, .sidecontentbox .author, div.md a[href^="/u/"]:not([href*="/m/"]), div.md a[href*="reddit.com/u/"]:not([href*="/m/"]), .usertable a.author, .usertable span.user a, div.wiki-page-content .author';

const ignoreIcons = {
	IGNORED: '\uF038',
	NORMAL: '\uF03B',
};

const $tagDialog = _.once(() => {
	const colors = Object.entries(bgToTextColorMap)
		.map(([color, textColor]) => ({
			textColor,
			bgColor: (color === 'none') ? 'transparent' : color,
			color,
		}));

	const $tagger = $(string.html`
		<div id="userTaggerToolTip" class="RESDialogSmall">
			<h3><span class="res-icon">&#xF0AC;</span>&nbsp;<span>User</span></h3>
			<div id="userTaggerToolTipContents" class="RESDialogContents">
				<form name="userTaggerForm" action="">
					<input type="hidden" id="userTaggerName">
					<div>
						<label for="userTaggerTag">Tag</label>
						<input type="text" id="userTaggerTag">
					</div>
					<div>
						<label for="userTaggerColor">Color</label>
						<select id="userTaggerColor">
							${colors.map(({ textColor, bgColor, color }) => string._html`
								<option style="color: ${textColor}; background-color: ${bgColor} !important" value="${color}">${color}</option>
							`)}
						</select>
					</div>
					<div>
						<label for="userTaggerPreview">Preview</label>
						<span id="userTaggerPreview"></span>
					</div>
					<div class="res-usertag-ignore">
						<label for="userTaggerIgnore">Ignore</label>
					</div>
					<div>
						<label for="userTaggerLink">
							<span class="userTaggerOpenLink">
								<a title="open link">Source URL</a>
							</span>
						</label>
						<input type="text" id="userTaggerLink">
					</div>
					<div>
						<label for="userTaggerVoteWeight" title="The sum of upvotes and downvotes you have given this redditor">Vote Weight
							<span class="hoverHelp" title="manually edit vote weight (sum of upvotes and downvotes) for this redditor">(?)</span>
						</label>
						<input type="text" size="2" id="userTaggerVoteWeight">
					</div>
					<div class="res-usertagger-footer">
						<a href="/r/dashboard#userTaggerContents" target="_blank" rel="noopener noreferer">View tagged users</a>
						<input type="submit" id="userTaggerSave" value="✓ save tag">
					</div>
				</form>
				<div id="userTaggerClose" class="RESCloseButton">&times;</div>
			</div>
		</div>
	`);

	const ignoreToggleButton = CreateElement.toggleButton(undefined, 'userTaggerIgnore', false, ignoreIcons.IGNORED, ignoreIcons.NORMAL, false, true);
	ignoreToggleButton.classList.add('reverseToggleButton');
	const ignoreSettingsLink = SettingsNavigation.makeUrlHashLink(module.moduleID, 'hardIgnore', ' configure ', 'gearIcon');
	$tagger.find('.res-usertag-ignore').append(ignoreToggleButton, ignoreSettingsLink);

	// Add event listeners.
	const $tag = $tagger.find('#userTaggerTag')
		.on('keyup', updateTagPreview)
		.on('keydown', (e: KeyboardEvent) => {
			if (e.keyCode === 27) {
				// close on ESC key.
				closeUserTagPrompt();
			}
		});
	const $color = $tagger.find('#userTaggerColor').on('change', updateTagPreview);
	const $link = $tagger.find('#userTaggerLink').on('keyup', updateOpenLink);
	const $openLink = $tagger.find('.userTaggerOpenLink a').on('click', (e: Event) => {
		e.preventDefault();
		const links = $('#userTaggerLink').val().split(/\s/);
		openNewTabs('none', ...links);
	});
	$tagger.find('#userTaggerSave').on('click', (e: Event) => {
		e.preventDefault();
		saveTagForm();
	});
	$tagger.find('#userTaggerClose').on('click', closeUserTagPrompt);
	$tagger.find('form').on('submit', e => {
		e.preventDefault();
		saveTagForm();
	});

	const name = downcast($tagger.find('#userTaggerName').get(0), HTMLInputElement);
	const tag = downcast($tag.get(0), HTMLInputElement);
	const color = downcast($color.get(0), HTMLSelectElement);
	const link = downcast($link.get(0), HTMLInputElement);
	const ignore = downcast($tagger.find('#userTaggerIgnore').get(0), HTMLInputElement);
	const ignoreContainer = downcast($tagger.find('#userTaggerIgnoreContainer').get(0), HTMLElement);
	const votes = downcast($tagger.find('#userTaggerVoteWeight').get(0), HTMLInputElement);
	const $preview = $tagger.find('#userTaggerPreview');
	const $usernameTitle = $tagger.find('h3 span:last-of-type');

	return { $tagger, $preview, $usernameTitle, $openLink, name, tag, color, link, ignore, ignoreContainer, votes };
});

function addTagger() {
	$tagDialog().$tagger.appendTo(document.body);
}

function registerCommandLine() {
	CommandLine.registerCommand('tag', `tag [text] - ${i18n('userTaggerCommandLineDescription')}`,
		(command, val) => {
			const tagLink = getAuthorTagLink();
			if (tagLink) {
				return i18n(val ? 'userTaggerTagUserAs' : 'userTaggerTagUser', tagLink.getAttribute('username'), val);
			} else {
				return i18n('userTaggerTagCanNotSetTag');
			}
		},
		(command, val) => {
			const tagLink = getAuthorTagLink();
			if (tagLink) {
				click(tagLink);
				setTimeout(() => {
					if (val !== '') {
						$tagDialog().tag.value = val;
					}
				}, 20);
			} else {
				return i18n('userTaggerTagCanNotSetTag');
			}
		}
	);

	function getAuthorTagLink() {
		const selected = SelectedEntry.selectedThing;
		const searchArea = selected ? selected.entry : document.body;

		return searchArea.querySelector('a.userTagLink');
	}
}

function attachVoteHandler() {
	// hand-rolled delegated listener because jQuery doesn't support useCapture
	// which is necessary so we run before reddit's handler
	document.body.addEventListener('click', (e: MouseEvent) => {
		if (e.button !== 0) return;
		const $target = $(e.target);
		if ($target.is('.arrow')) {
			handleVoteClick($target);
		}
	}, true);
}

async function handleVoteClick($this) {
	const $otherArrow = $this.siblings('.arrow');
	const thing = Thing.checkedFrom($this);
	const thisAuthor = thing.getAuthor();

	// Stop if the post is archived (unvotable) or you are voting on your own post/comment/etc.
	if ($this.hasClass('archived') || !thisAuthor || thisAuthor === loggedInUser()) {
		return;
	}

	// there are 6 possibilities here:
	// 1) no vote yet, click upmod
	// 2) no vote yet, click downmod
	// 3) already upmodded, undoing
	// 4) already downmodded, undoing
	// 5) upmodded before, switching to downmod
	// 6) downmodded before, switching to upmod

	// classes are changed AFTER this event is triggered
	let voteDelta = 0;
	if ($this.hasClass('up')) {
		// adding an upvote
		voteDelta++;
		if ($otherArrow.hasClass('downmod')) {
			// also removing a downvote
			voteDelta++;
		}
	} else if ($this.hasClass('upmod')) {
		// removing an upvote directly
		voteDelta--;
	} else if ($this.hasClass('down')) {
		// adding a downvote
		voteDelta--;
		if ($otherArrow.hasClass('upmod')) {
			// also removing an upvote
			voteDelta--;
		}
	} else if ($this.hasClass('downmod')) {
		// removing a downvote directly
		voteDelta++;
	}

	// must load tag object _after_ checking the DOM, so that classes will not be changed
	const tagObject = await tagStorage.get(thisAuthor);
	const votes = (parseInt(tagObject.votes, 10) || 0) + voteDelta;

	tagObject.votes = votes;
	tagStorage.patch(thisAuthor, { votes });

	const thisAuthorObj = thing.getAuthorElement();
	let thisVWobj = $(thisAuthorObj).nextAll('.voteWeight')[0];
	if (!thisVWobj /*:: && thisAuthorObj */) {
		addAuthorTag(thisAuthorObj, false, thisAuthor, tagObject);
		thisVWobj = $(thisAuthorObj).nextAll('.voteWeight')[0];
	}

	colorUser(thisVWobj, thisAuthor, votes);
}

let currentSortMethod, isDescending;

async function drawUserTagTable(sortMethod, descending) {
	currentSortMethod = sortMethod || currentSortMethod;
	isDescending = (descending === undefined || descending === null) ? isDescending : descending;
	const taggedUsers = [];
	const filterType = $('#tagFilter').val();
	const tags = await tagStorage.getAll();
	for (const tagIndex in tags) {
		if (filterType === 'tagged users') {
			if (typeof tags[tagIndex].tag !== 'undefined') {
				taggedUsers.push(tagIndex);
			}
		} else {
			taggedUsers.push(tagIndex);
		}
	}
	switch (currentSortMethod) {
		case 'tag':
			taggedUsers.sort((a, b) => {
				const tagA = (typeof tags[a].tag === 'undefined') ? 'zzzzz' : tags[a].tag.toLowerCase();
				const tagB = (typeof tags[b].tag === 'undefined') ? 'zzzzz' : tags[b].tag.toLowerCase();
				return (tagA > tagB) ? 1 : (tagB > tagA) ? -1 : 0;
			});
			if (isDescending) {
				taggedUsers.reverse();
			}
			break;
		case 'ignore':
			taggedUsers.sort((a, b) => {
				const tagA = (typeof tags[a].ignore === 'undefined') ? 'z' : 'a';
				const tagB = (typeof tags[b].ignore === 'undefined') ? 'z' : 'a';
				return (tagA > tagB) ? 1 : (tagB > tagA) ? -1 : 0;
			});
			if (isDescending) {
				taggedUsers.reverse();
			}
			break;
		case 'color':
			taggedUsers.sort((a, b) => {
				const colorA = (typeof tags[a].color === 'undefined') ? 'zzzzz' : tags[a].color.toLowerCase();
				const colorB = (typeof tags[b].color === 'undefined') ? 'zzzzz' : tags[b].color.toLowerCase();
				return (colorA > colorB) ? 1 : (colorB > colorA) ? -1 : 0;
			});
			if (isDescending) {
				taggedUsers.reverse();
			}
			break;
		case 'votes':
			taggedUsers.sort((a, b) => {
				const tagA = (typeof tags[a].votes === 'undefined') ? 0 : tags[a].votes;
				const tagB = (typeof tags[b].votes === 'undefined') ? 0 : tags[b].votes;
				return (
					(tagA > tagB) ? 1 :
					(tagA < tagB) ? -1 :
					(a.toLowerCase() > b.toLowerCase()) ? 1 :
					(a.toLowerCase() < b.toLowerCase()) ? -1 :
					0
				);
			});
			if (isDescending) {
				taggedUsers.reverse();
			}
			break;
		case 'username':
			/* falls through */
		default:
			// sort users, ignoring case
			taggedUsers.sort((a, b) =>
				(a.toLowerCase() > b.toLowerCase()) ? 1 : (b.toLowerCase() > a.toLowerCase()) ? -1 : 0
			);
			if (isDescending) {
				taggedUsers.reverse();
			}
			break;
	}
	$('#userTaggerTable tbody').html('');
	const tagsPerPage = parseInt(Dashboard.module.options.tagsPerPage.value, 10);
	const count = taggedUsers.length;
	let start = 0;
	let end = count;

	if (tagsPerPage) {
		const $tagControls = $('#tagPageControls');
		let page = $tagControls.data('page');
		const pages = Math.ceil(count / tagsPerPage);
		page = Math.min(page, pages);
		page = Math.max(page, 1);
		$tagControls.data('page', page).data('pageCount', pages);
		$tagControls.find('.res-step-progress').text(i18n('userTaggerPageXOfY', page, pages));
		start = tagsPerPage * (page - 1);
		end = Math.min(count, tagsPerPage * page);
	}

	taggedUsers
		.slice(start, end)
		.forEach((thisUser, userIndex) => {
			const thisTag = (typeof tags[thisUser].tag === 'undefined') ? '' : tags[thisUser].tag;
			const thisVotes = (typeof tags[thisUser].votes === 'undefined') ? 0 : tags[thisUser].votes;
			const thisColor = (typeof tags[thisUser].color === 'undefined') ? '' : tags[thisUser].color;
			const thisIgnore = (typeof tags[thisUser].ignore === 'undefined') ? ignoreIcons.NORMAL : ignoreIcons.IGNORED;

			const userTagLink = document.createElement('a');
			if (thisTag === '') {
				// thisTag = '<div class="RESUserTagImage"></div>';
				userTagLink.setAttribute('class', 'userTagLink RESUserTagImage');
			} else {
				userTagLink.setAttribute('class', 'userTagLink hasTag');
			}
			$(userTagLink).text(thisTag);
			if (thisColor) {
				const bgColor = (thisColor === 'none') ? 'transparent' : thisColor;
				userTagLink.setAttribute('style', `background-color: ${bgColor}; color: ${bgToTextColorMap[thisColor]} !important;`);
			}
			userTagLink.setAttribute('username', thisUser);
			userTagLink.setAttribute('title', i18n('userTaggerSetATag'));
			userTagLink.setAttribute('href', 'javascript:void 0'); // eslint-disable-line no-script-url
			userTagLink.addEventListener('click', function(e: Event) {
				e.preventDefault();
				openUserTagPrompt(e.target, this.getAttribute('username'));
			}, true);

			$('#userTaggerTable tbody').append(`
			    <tr>
			        <td>
			            <span class="res-icon res-right deleteIcon" data-icon="&#xf056;" user="${thisUser}"></span>
			            <a class="author" href="/user/${thisUser}">${thisUser}</a>
                    </td>
                    <td id="tag_${userIndex}"></td>
                    <td id="ignore_${userIndex}" class="res-icon">${thisIgnore}</td>
                    <td><span style="color: ${thisColor}">${thisColor}</span></td>
                    <td>${thisVotes}</td>
                </tr>
            `);

			$(`#tag_${userIndex}`).append(userTagLink);
		});
	$('#userTaggerTable tbody .deleteIcon').click(function() {
		const thisUser = $(this).attr('user').toLowerCase();
		const $button = $(this);
		Alert.open(i18n('userTaggerAreYouSureYouWantToDeleteTag', thisUser), { cancelable: true })
			.then(() => {
				tagStorage.delete(thisUser);
				$button.closest('tr').remove();
			});
	});
}

function saveTagForm() {
	const { name, tag, color, ignore, link, votes } = $tagDialog();
	setUserTag(
		name.value,
		tag.value,
		color.value,
		ignore.checked,
		link.value,
		parseInt(votes.value, 10) || 0
	);
}

const bgToTextColorMap = {
	none: 'inherit',
	aqua: 'black',
	black: 'white',
	blue: 'white',
	cornflowerblue: 'white',
	fuchsia: 'white',
	gray: 'white',
	green: 'white',
	lime: 'black',
	maroon: 'white',
	navy: 'white',
	olive: 'white',
	orange: 'white',
	orangered: 'white',
	pink: 'black',
	purple: 'white',
	red: 'white',
	silver: 'black',
	teal: 'white',
	white: 'black',
	yellow: 'black',
};

let clickedTag;

async function openUserTagPrompt(obj, username) {
	clickedTag = obj;
	$tagDialog().$usernameTitle.text(username);
	$tagDialog().name.value = username;

	const tagObject = await tagStorage.get(username);

	if (typeof tagObject.link !== 'undefined') {
		$tagDialog().link.value = tagObject.link;
	} else {
		$tagDialog().link.value = '';
	}
	if (typeof tagObject.tag !== 'undefined') {
		$tagDialog().tag.value = tagObject.tag;
	} else {
		$tagDialog().tag.value = '';
		if (typeof tagObject.link === 'undefined') {
			// since we haven't yet set a tag or a link for this user, auto populate a link for the
			// user based on where we are tagging from.
			setLinkBasedOnTagLocation(obj);
		}
	}
	const ignored = !!tagObject.ignore;
	$tagDialog().ignore.checked = ignored;
	$tagDialog().ignoreContainer.classList.toggle('enabled', ignored);
	if (typeof tagObject.votes !== 'undefined') {
		$tagDialog().votes.value = String(tagObject.votes);
	} else {
		$tagDialog().votes.value = '';
	}
	if (typeof tagObject.color !== 'undefined') {
		$($tagDialog().color).val(tagObject.color);
	} else {
		$tagDialog().color.selectedIndex = 0;
	}

	setTaggerPosition();

	$tagDialog().tag.focus();
	updateOpenLink();
	updateTagPreview();
	return false;
}

function setLinkBasedOnTagLocation(obj) {
	const closestEntry = $(obj).closest('.entry');
	let linkTitle = '';
	if (!module.options.useCommentsLinkAsSource.value) {
		linkTitle = $(closestEntry).find('a.title');
	}
	// if we didn't find anything, try a new search (works on inbox)
	if (!linkTitle.length) {
		linkTitle = $(closestEntry).find('a.bylink');
	}
	if (linkTitle.length) {
		$tagDialog().link.value = $(linkTitle).attr('href');
	} else {
		const permaLink = $(closestEntry).find('.flat-list.buttons li.first a');
		if (permaLink.length) {
			$tagDialog().link.value = $(permaLink).attr('href');
		}
	}
}

function updateTagPreview() {
	const bgcolor = $($tagDialog().color).find('option:selected').val();
	$tagDialog().$preview
		.text($tagDialog().tag.value)
		.css({
			backgroundColor: (bgcolor === 'none') ? 'transparent' : bgcolor,
			color: bgToTextColorMap[bgcolor],
		});
}

function updateOpenLink(e?: Event) {
	const $link = $tagDialog().$openLink;
	const el = e ? e.target : $tagDialog().link;
	if ($(el).val().length > 0) {
		$link.attr('href', $(el).val().split(/\s/)[0]);
	} else {
		$link.removeAttr('href');
	}
}

function setTaggerPosition() {
	const { top, left } = $(clickedTag).offset();
	const right = document.body.clientWidth - left;

	$tagDialog().$tagger.css({ top });
	$tagDialog().$tagger.show();

	if (left < right) {
		$tagDialog().$tagger.css({ right: 'auto', left });
	} else {
		$tagDialog().$tagger.css({ right, left: 'auto' });
	}
}

function closeUserTagPrompt() {
	$tagDialog().$tagger.hide();
	if (Modules.isRunning(KeyboardNav)) {
		// remove focus from any input fields from the prompt so that keyboard navigation works again...
		$tagDialog().$tagger.find('input, button').blur();
	}
}

async function setUserTag(username, tag, color, ignore, link, votes, noclick) {
	const tagObject = await tagStorage.get(username);
	if ((tag !== null && tag !== '') || ignore) {
		if (tag === '') {
			tag = 'ignored';
		}
		tagObject.tag = tag;
		tagObject.link = link;
		tagObject.color = color;
		const bgColor = (color === 'none') ? 'transparent' : color;
		if (ignore) {
			tagObject.ignore = true;

			Notifications.showNotification({
				moduleID: module.moduleID,
				notificationID: 'addedToIgnoreList',
				message: `
					<p>Now ignoring content posted by ${username}.</p>
					${isPageType('inbox') ? `
						<p>If you wish to block ${username} from sending you messages, go to <a href="/message/messages/">your messages</a> and click 'block user' underneath their last message.</p>
						<p><a href="https://www.reddit.com/r/changelog/comments/ijfps/reddit_change_users_may_block_other_users_that/">About blocking users</a>.</p>
					` : ''}
				`,
				closeDelay: 5000,
			});
		} else {
			delete tagObject.ignore;
		}
		if (!noclick) {
			clickedTag.setAttribute('class', 'userTagLink hasTag');
			clickedTag.setAttribute('style', `background-color: ${bgColor}; color: ${bgToTextColorMap[color]} !important;`);
			$(clickedTag).text(tag);
		}
	} else {
		delete tagObject.tag;
		delete tagObject.color;
		delete tagObject.link;
		if (tagObject.tag === 'ignored') {
			delete tagObject.tag;
		}
		delete tagObject.ignore;

		if (!noclick) {
			clickedTag.setAttribute('style', 'background-color: transparent');
			clickedTag.setAttribute('class', 'userTagLink RESUserTagImage');
			$(clickedTag).html('');
		}
	}

	tagObject.votes = (isNaN(votes)) ? 0 : votes;

	if (!noclick) {
		const thisVW: ?HTMLAnchorElement = (clickedTag.parentNode: any).parentNode.querySelector('a.voteWeight');
		if (thisVW) {
			colorUser(thisVW, username, votes);
		}
	}
	if (_.isEmpty(tagObject)) {
		tagStorage.delete(username);
	} else {
		tagStorage.set(username, tagObject);
	}
	closeUserTagPrompt();
}

const getTagBatched = batch(async users => {
	const tags = await tagStorage.batch(users);
	return users.map(user => tags[user.toLowerCase()]);
}, { size: Infinity, delay: 0 });

export async function applyTagToAuthor(thisAuthorObj: HTMLAnchorElement, noEdit: boolean = false) {
	let thisAuthor;
	if (thisAuthorObj.href) {
		const test = thisAuthorObj.href.match(usernameRE);
		if (test) {
			thisAuthor = test[1];
		} else {
			console.error(`Regex failed on ${thisAuthorObj.href}, returning.`);
			return;
		}
	} else {
		thisAuthor = (
			thisAuthorObj.getAttribute('data-user') ||
			thisAuthorObj.innerText ||
			''
		);
	}

	const tagObject = await getTagBatched(thisAuthor);

	if (module.options.showTaggingIcon.value || !_.isEmpty(tagObject)) {
		addAuthorTag(thisAuthorObj, noEdit, thisAuthor, tagObject);
	}

	if (
		tagObject.ignore && !noEdit &&
		thisAuthorObj.classList.contains('author') && !isPageType('profile')
	) {
		const thing = Thing.from(thisAuthorObj);
		if (thing) ignore(thing);
	}
}

function addAuthorTag(thisAuthorObj: HTMLAnchorElement, noEdit: boolean, thisAuthor, { votes = 0, color, tag } = {}) {
	let userTagLink;

	function addUserTag() {
		userTagLink = document.createElement('a');
		if (!tag) {
			userTagLink.setAttribute('class', 'userTagLink RESUserTagImage');
		} else {
			userTagLink.setAttribute('class', 'userTagLink hasTag');
		}
		$(userTagLink).text(tag || '');
		if (color) {
			const bgColor = (color === 'none') ? 'transparent' : color;
			userTagLink.setAttribute('style', `background-color: ${bgColor}; color: ${bgToTextColorMap[color]} !important;`);
		}
		if (!noEdit) {
			userTagLink.setAttribute('username', thisAuthor);
			userTagLink.setAttribute('title', 'set a tag');
			userTagLink.setAttribute('href', 'javascript:void 0'); // eslint-disable-line no-script-url
			userTagLink.addEventListener('click', function(e: Event) {
				e.preventDefault();
				openUserTagPrompt(e.target, this.getAttribute('username'));
			}, true);
		}

		const userTag = document.createElement('span');
		userTag.appendChild(userTagLink);
		userTag.classList.add('RESUserTag');
		$(thisAuthorObj).after(userTag);
	}

	function addTrackVoteWeight() {
		const userVoteFrag = document.createDocumentFragment();
		const spacer = document.createTextNode(' ');
		userVoteFrag.appendChild(spacer);
		const userVoteWeight = document.createElement('a');
		userVoteWeight.setAttribute('href', '#');
		userVoteWeight.setAttribute('class', 'voteWeight');
		$(userVoteWeight).text('[vw]');
		userVoteWeight.addEventListener('click', (e: Event) => {
			e.preventDefault();
			if (!userTagLink) addUserTag();
			openUserTagPrompt(userTagLink, thisAuthor);
		}, true);
		colorUser(userVoteWeight, thisAuthor, votes);
		userVoteFrag.appendChild(userVoteWeight);
		$(userVoteFrag).insertAfter(thisAuthorObj);
	}

	if (noEdit) {
		if (tag) addUserTag();
		return;
	}

	if (module.options.trackVoteWeight.value) addTrackVoteWeight();
	if (tag || module.options.showTaggingIcon.value) addUserTag();
}

// Ignore content from certain users.
// For blocking users from sending messages to other users, see reddit's built-in block feature.
function ignore(thing) {
	thing.element.classList.add('res-ignored-content');

	if (thing.isPost()) {
		ignorePost(thing);
	} else if (thing.isComment()) {
		ignoreComment(thing);
	}
}

function ignorePost(thing) {
	if (module.options.hardIgnore.value) {
		// hardIgnore, remove post completely
		thing.element.remove();
	} else {
		// no hardIgnore, replace title with placeholder
		const title = downcast(thing.getTitleElement(), HTMLElement);
		ignoredPlaceholder(thing).insertAfter(title);
	}
}

function ignoreComment(thing) {
	if (module.options.hardIgnore.value) {
		if ($(thing.element).children('.child').children().length === 0) {
			// hardIgnore and no children, remove completely
			thing.element.remove();
			return;
		} else if (thing.element.classList.contains('noncollapsed')) {
			// hardIgnore and children, collapse
			const toggleComment = downcast(thing.entry.querySelector('a.expand'), HTMLElement);
			click(toggleComment);
		}
	}

	// replace body with placeholder (both with/without hardIgnore)
	const body = downcast(thing.entry.querySelector('.md'), HTMLElement);
	ignoredPlaceholder(thing).insertAfter(body);
}

function ignoredPlaceholder(thing) {
	const $wrapper = $('<span>', { class: 'res-ignored-message' }).append(
		$('<span>', { class: 'res-icon', text: '\uF093' }),
		$('<span>', { text: ` ${i18n('userTaggerIgnoredPlaceholder')} ` })
	);

	if (module.options.showIgnored.value) {
		const $button = $('<a>', { href: '#', text: i18n('userTaggerShowAnyway') });
		$button.click(e => {
			e.preventDefault();
			thing.element.classList.remove('res-ignored-content');
			$wrapper.remove();
		});
		$button.appendTo($wrapper);
	}

	return $wrapper;
}

function colorUser(obj, author, votes) {
	if (module.options.trackVoteWeight.value) {
		votes = parseInt(votes, 10);
		let red = 255;
		let green = 255;
		let blue = 255;
		let voteString = '+';
		if (votes > 0) {
			red = Math.max(0, (255 - (8 * votes)));
			green = 255;
			blue = Math.max(0, (255 - (8 * votes)));
		} else if (votes < 0) {
			red = 255;
			green = Math.max(0, (255 - Math.abs(8 * votes)));
			blue = Math.max(0, (255 - Math.abs(8 * votes)));
			voteString = '';
		}
		voteString += votes;
		const rgb = `rgb(${red}, ${green}, ${blue})`;
		if (obj) {
			if (votes === 0) {
				obj.style.display = 'none';
			} else {
				obj.style.display = 'inline';
				if (NightMode.isNightModeOn()) {
					obj.style.color = rgb;
				} else {
					obj.style.backgroundColor = rgb;
				}
				if (module.options.vwNumber.value) {
					obj.textContent = `[${voteString}]`;
				}
				if (module.options.vwTooltip.value) {
					obj.setAttribute('title', i18n('userTaggerYourVotesFor', author, voteString));
				}
			}
		}
	}
}

export async function ignoreUser(username: string, ignore: boolean) {
	const thisIgnore = ignore !== false;
	const {
		color = 'none',
		link = '',
		votes = 0,
		tag: oldTag = '',
	} = await tagStorage.get(username);
	let tag = oldTag;

	if (thisIgnore && tag === '') {
		tag = 'ignored';
	} else if (!thisIgnore && tag === 'ignored') {
		tag = '';
	}
	setUserTag(username, tag, color, thisIgnore, link, votes, true /* noclick */);
}
