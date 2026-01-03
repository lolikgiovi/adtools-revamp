import './styles.css';
import { FeedbackTemplate } from './template.js';

class FeedbackPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
  }

  mount(root) {
    if (!root) {
      console.error('FeedbackPage: root container not provided');
      return;
    }
    root.innerHTML = FeedbackTemplate;
    this.bindEvents(root);
  }

  bindEvents(root) {
    const form = root.querySelector('.feedback-form');
    const textarea = root.querySelector('#feedback-text');

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = textarea?.value.trim() || '';
      if (!message) {
        this.eventBus?.emit?.('notification:show', { message: 'Feedback cannot be empty', type: 'warning' });
        return;
      }
      this.eventBus?.emit?.('notification:show', { message: 'Thanks for your feedback!', type: 'success' });
    });
  }
}

export { FeedbackPage };