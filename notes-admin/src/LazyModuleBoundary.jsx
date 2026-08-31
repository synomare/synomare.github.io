import { Component } from 'react';

export default class LazyModuleBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) return this.props.renderError(this.retry);
    return this.props.renderContent();
  }
}
