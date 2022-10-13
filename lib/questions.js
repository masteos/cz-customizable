const _ = require('lodash');
const buildCommit = require('./build-commit');
const log = require('./logger');
const getPreviousCommit = require('./utils/get-previous-commit');

const MESSAGE_DEFAULTS = {
  TYPE: 'Select the type of change that you\'re committing:',
  SCOPE: '\nDenote the SCOPE of this change (optional):',
  CUSTOM_SCOPE: 'Denote the SCOPE of this change:',
  TICKET_NUMBER_REGEXP: 'Enter the ticket number following this pattern',
  TICKET_NUMBER: 'Enter the ticket number:\n',
  SUBJECT: 'Write a SHORT, IMPERATIVE tense description of the change:\n',
  BODY: 'Provide a LONGER description of the change (optional). Use "|" to break new line:\n',
  BREAKING: 'List any BREAKING CHANGES (optional):\n',
  FOOTER: 'List any ISSUES CLOSED by this change (optional). E.g.: #31, #34:\n',
  CONFIRM_COMMIT: 'Are you sure you want to proceed with the commit above?'
};

const isNotWip = (answers) => {
  return answers.type.toLowerCase() !== 'wip';
};

const isValidateTicketNo = (value, config) => {
  if (!value) {
    return !config.isTicketNumberRequired;
  }
  if (!config.ticketNumberRegExp) {
    return true;
  }
  const reg = new RegExp(config.ticketNumberRegExp);

  return value.replace(reg, '') === '';
};

const getPreparedCommit = (context) => {
  let message = null;

  const preparedCommit = getPreviousCommit();

  if (preparedCommit) {
    const splitPreparedCommit = preparedCommit
      .replace(/^#.*/gm, '')
      .replace(/^\s*[\r\n]/gm, '')
      .replace(/[\r\n]$/, '')
      .split(/\r\n|\r|\n/);

    if (splitPreparedCommit.length && splitPreparedCommit[0]) {
      if (context === 'subject') [message] = splitPreparedCommit;
      else if (context === 'body' && splitPreparedCommit.length > 1) {
        splitPreparedCommit.shift();
        message = splitPreparedCommit.join('|');
      }
    }
  }

  return message;
};

module.exports = {
  getQuestions(config, cz) {
    // normalize config optional options
    const scopeOverrides = config.scopeOverrides || {};
    const messages = config.messages || {};
    const skipQuestions = config.skipQuestions || [];
    const skipEmptyScopes = config.skipEmptyScopes || false;

    messages.type = messages.type || MESSAGE_DEFAULTS.TYPE;
    messages.scope = messages.scope || MESSAGE_DEFAULTS.SCOPE;
    messages.customScope = messages.customScope || MESSAGE_DEFAULTS.CUSTOM_SCOPE;
    if (!messages.ticketNumber) {
      if (config.ticketNumberRegExp) {
        messages.ticketNumber = messages.ticketNumberPattern
          || `${MESSAGE_DEFAULTS.TICKET_NUMBER_REGEXP} (${config.ticketNumberRegExp})\n`;
      } else {
        messages.ticketNumber = MESSAGE_DEFAULTS.TICKET_NUMBER;
      }
    }

    messages.subject = messages.subject || MESSAGE_DEFAULTS.SUBJECT;
    messages.body = messages.body || MESSAGE_DEFAULTS.BODY;
    messages.breaking = messages.breaking || MESSAGE_DEFAULTS.BREAKING;
    messages.footer = messages.footer || MESSAGE_DEFAULTS.FOOTER;
    messages.confirmCommit = messages.confirmCommit || MESSAGE_DEFAULTS.CONFIRM_COMMIT;

    let questions = [
      {
        type: 'list',
        name: 'type',
        message: messages.type,
        choices: config.types
      },
      {
        type: 'list',
        name: 'scope',
        message: messages.scope,
        choices(answers) {
          let scopes = [];
          if (scopeOverrides[answers.type]) {
            scopes = scopes.concat(scopeOverrides[answers.type]);
          } else {
            scopes = scopes.concat(config.scopes);
          }
          if (config.allowCustomScopes || scopes.length === 0) {
            scopes = scopes.concat([
              new cz.Separator(),
              { name: 'empty', value: false },
              { name: 'custom', value: 'custom' }
            ]);
          }
          return scopes;
        },
        when(answers) {
          let hasScope = false;
          if (scopeOverrides[answers.type]) {
            hasScope = (scopeOverrides[answers.type].length > 0);
          } else {
            hasScope = !!(config.scopes && config.scopes.length > 0);
          }
          if (!hasScope) {
            // TODO: Fix when possible
            // eslint-disable-next-line no-param-reassign
            answers.scope = skipEmptyScopes ? '' : 'custom';
            return false;
          }
          return isNotWip(answers);
        }
      },
      {
        type: 'input',
        name: 'customScope',
        message: messages.customScope,
        when(answers) {
          return answers.scope === 'custom';
        }
      },
      {
        type: 'input',
        name: 'ticketNumber',
        message: messages.ticketNumber,
        when() {
          return !!config.allowTicketNumber; // no ticket numbers allowed unless specified
        },
        validate(value) {
          return isValidateTicketNo(value, config);
        }
      },
      {
        type: 'input',
        name: 'subject',
        message: messages.subject,
        default: config.usePreparedCommit && getPreparedCommit('subject'),
        validate(value) {
          const limit = config.subjectLimit || 100;
          if (value.length > limit) {
            return `Exceed limit: ${limit}`;
          }
          return true;
        },
        filter(value) {
          const upperCaseSubject = config.upperCaseSubject || false;

          return (upperCaseSubject ? value.charAt(0).toUpperCase() : value.charAt(0).toLowerCase()) + value.slice(1);
        }
      },
      {
        type: 'input',
        name: 'body',
        message: messages.body,
        default: config.usePreparedCommit && getPreparedCommit('body')
      },
      {
        type: 'input',
        name: 'breaking',
        message: messages.breaking,
        when(answers) {
          return !!(config.askForBreakingChangeFirst
            || (config.allowBreakingChanges && config.allowBreakingChanges.indexOf(answers.type.toLowerCase()) >= 0));
          // no breaking changes allowed unless specified
        }
      },
      {
        type: 'input',
        name: 'footer',
        message: messages.footer,
        when: isNotWip
      },
      {
        type: 'expand',
        name: 'confirmCommit',
        choices: [
          { key: 'y', name: 'Yes', value: 'yes' },
          { key: 'n', name: 'Abort commit', value: 'no' },
          { key: 'e', name: 'Edit message', value: 'edit' }
        ],
        default: 0,
        message(answers) {
          const SEP = '###--------------------------------------------------------###';
          log.info(`\n${SEP}\n${buildCommit(answers, config)}\n${SEP}\n`);
          return messages.confirmCommit;
        }
      }
    ];

    questions = questions.filter((item) => { return !skipQuestions.includes(item.name); });

    if (config.askForBreakingChangeFirst) {
      const isBreaking = (oneQuestion) => { return oneQuestion.name === 'breaking'; };

      const breakingQuestion = _.filter(questions, isBreaking);
      const questionWithoutBreaking = _.reject(questions, isBreaking);

      questions = _.concat(breakingQuestion, questionWithoutBreaking);
    }

    return questions;
  }
};
